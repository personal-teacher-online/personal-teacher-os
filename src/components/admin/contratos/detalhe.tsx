// AS SEÇÕES DO DETALHE DO CONTRATO (Onda 1 · M4-2).
//
// A anatomia é a da FICHA DO ALUNO (M3-2), e de propósito: são as mesmas peças
// (`Secao` com o lápis à direita, `Pares` rótulo/valor em grade com hairline,
// `Linhas`/`Linha` para lista dentro da seção), porque é a mesma pessoa lendo as
// duas telas no mesmo dia. O que muda é o assunto.
//
// CADA SEÇÃO É UMA CAIXA (portão visual do dono, 27/07/2026 — ordem direta,
// olhando a bancada): as cinco seções moravam num cartão único, separadas por
// hairline, e viraram cinco CARTÕES-CONTÊINER com respiro entre eles. A moldura
// é a linguagem de contêiner da casa (`.panel-tb` via `CardPanel`: anel de 1px,
// raio 8, FLAT) — nunca o `.card-kpi` elevado, que é a receita de cartão
// CLICÁVEL e prometeria um clique que a seção não tem. Nada de lógica mudou:
// título, apoio e ações de cada seção são exatamente os que já existiam.
//
// A TELA NÃO DECIDE NADA (Lei 3). Ela só ANTECIPA o que o banco já decide:
// · aula passada sem desfecho > 0 → encerrar e renovar aparecem DESABILITADOS,
//   com a frase e o número (o gate duro é `_contract_pending_count`);
// · pausar só existe em contrato ativo, retomar só em contrato pausado (as RPCs
//   `pause_contract`/`resume_contract` recusam o resto);
// · contrato ENCERRADO não mostra lápis nenhum — não há mais o que editar;
// · preço e professora NÃO se editam: `admin_update_contract_rules` só mexe em
//   plano e franquia, e trocar valor é uma DECISÃO REGISTRADA, que se chama
//   renovação. A seção diz isso em vez de esconder.
//
// Lei 1: nenhuma data é formatada aqui. Horário, vigência, pausa e assinatura
// chegam prontos de `contrato-detalhe.ts`.

import Link from 'next/link'
import type { ComponentProps } from 'react'

import {
  Lapis,
  Linha,
  Linhas,
  Pares,
  Secao,
} from '@/components/admin/alunos/ficha/pecas'
import { CardPanel } from '@/components/kit/card-panel'
import { Pill } from '@/components/kit/pill'
import { TEACHER_FILL } from '@/components/ui'
import type { FichaDoContrato } from '@/data/admin/contrato-detalhe'
import {
  AVISO_DA_ASSINATURA_DESLIGADA,
  enderecoDoContrato,
} from '@/data/admin/contratos-gramatica'

/** A frase do gate duro, com o NÚMERO — é ele que diz o tamanho do trabalho. */
export function fraseDaPendencia(pendencias: number): string {
  return `${pendencias} aula${pendencias === 1 ? '' : 's'} passada${pendencias === 1 ? '' : 's'} sem desfecho ${
    pendencias === 1 ? 'trava' : 'travam'
  } encerrar e renovar. Registre o desfecho na Agenda (o botão “todas aconteceram” resolve as positivas) e volte aqui.`
}

/**
 * A frase do gate do FUSO (c12 · nº 6).
 *
 * `_require_confirmed_tz` recusa contrato e horário fixo de quem ainda está no
 * fuso-palpite — e num contrato de TURMA basta um membro por confirmar. A frase
 * diz o que fazer, não só o que aconteceu.
 */
export const MOTIVO_DO_FUSO =
  'A cidade ainda é um palpite do cadastro, e o banco recusa horário fixo até ela ser confirmada — no contrato de turma, basta um membro por confirmar. Abra a ficha do aluno, confirme a cidade e volte aqui.'

/**
 * Ação que só pode falhar: aparece, diz que está travada e não some.
 *
 * c12 · nº 6 — o gate do fuso passou a usar a MESMA peça do gate de pendência.
 * Antes, com o fuso no palpite, a tela mostrava um aviso E continuava
 * oferecendo "Novo horário"/"Mudar": a pessoa preenchia o Sheet inteiro para
 * ouvir a recusa do Postgres no submit. Antecipar de verdade é desabilitar a
 * porta e dizer por quê, que é o que a regra 3 de `paineis.tsx` já mandava.
 */
function AcaoTravada({ children, porque }: { children: string; porque: string }) {
  return (
    <button type="button" disabled className="btn-ac-soft" aria-describedby={porque}>
      {children}
    </button>
  )
}

/**
 * A seção dentro da CAIXA dela (portão visual do dono, 27/07/2026).
 *
 * A peça continua sendo a `Secao` da ficha — mesmo cabeçalho (título + ação),
 * mesmo apoio, mesmo corpo. O que entra é a moldura de contêiner da casa em
 * volta de cada uma, e o que sai é a hairline de baixo: quem separa uma seção
 * da outra agora é o respiro entre as caixas, e manter as duas coisas deixaria
 * um fio solto rente à borda do cartão.
 */
function SecaoEmCaixa(props: ComponentProps<typeof Secao>) {
  return (
    <CardPanel>
      <Secao {...props} className="border-b-0" />
    </CardPanel>
  )
}

function Professora({ nome, idx }: { nome: string | null; idx: number }) {
  if (!nome) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`h-2 w-2 rounded-full ${TEACHER_FILL[idx % TEACHER_FILL.length]}`} />
      {nome}
    </span>
  )
}

export function SecoesDoContrato({
  contrato,
  /**
   * A chave do Autentique está no ambiente? (ADR-029 §1)
   *
   * Quem responde é `assinaturaLigada()` (`lib/autentique/gate.ts`), chamado na
   * PÁGINA — este componente não lê env: ele desenha o que lhe disserem, e é por
   * isso que o aceite consegue provar os DOIS modos sem subir servidor.
   */
  assinaturaLigada,
}: {
  contrato: FichaDoContrato
  assinaturaLigada: boolean
}) {
  const self = (painel: Parameters<typeof enderecoDoContrato>[1]) =>
    enderecoDoContrato(contrato.id, painel)
  const editavel = !contrato.encerrado
  const travado = contrato.pendencias > 0
  // c12 · nº 6: o gate do fuso (o aluno, ou QUALQUER membro da turma, ainda com
  // a cidade por confirmar) — quem recusa é `_require_confirmed_tz`.
  const fusoNoPalpite = !contrato.fusoConfirmado

  return (
    <>
      {/* ------------------------------------------------- dados & valores */}
      <SecaoEmCaixa
        titulo="Dados & valores"
        apoio="Plano e franquia mudam daqui para a frente, sem tocar no que já aconteceu. Valor da aula e professora NÃO se editam: trocar preço é uma decisão registrada — o caminho é renovar o contrato."
        acao={
          editavel ? (
            <span className="flex items-center gap-2">
              <Lapis href={self({ painel: 'regras' })} rotulo="Editar" />
              {/* F2: a mensalidade tem porta própria (RPC própria, trilha própria). */}
              {contrato.tipo !== 'mentorship' && (
                <Lapis href={self({ painel: 'mensalidade' })} rotulo="Mensalidade" />
              )}
            </span>
          ) : undefined
        }
      >
        <Pares
          itens={[
            {
              rotulo: 'Professora',
              valor: <Professora nome={contrato.professora.nome} idx={contrato.professora.idx} />,
            },
            { rotulo: 'Valor da aula', valor: contrato.valorHora },
            // F2: DADO de dinheiro — "não cadastrada" é informação urgente (o
            // previsto da home lê 0 deste contrato enquanto isso).
            ...(contrato.tipo !== 'mentorship'
              ? [{ rotulo: 'Mensalidade', valor: contrato.mensalidade ?? 'não cadastrada' }]
              : []),
            { rotulo: 'Plano', valor: contrato.plano },
            {
              rotulo: 'Remarcações por mês',
              valor:
                contrato.politica.remarcacoes != null ? String(contrato.politica.remarcacoes) : null,
            },
            {
              rotulo: 'Aviso mínimo',
              valor: contrato.politica.avisoHoras != null ? `${contrato.politica.avisoHoras} h` : null,
            },
            {
              rotulo: 'Validade do crédito',
              valor:
                contrato.politica.validadeDias != null ? `${contrato.politica.validadeDias} dias` : null,
            },
            {
              rotulo: 'Validade quando a falha é da escola',
              valor:
                contrato.politica.falhaDaEscolaDias != null
                  ? `${contrato.politica.falhaDaEscolaDias} dias`
                  : null,
              largo: true,
            },
          ]}
        />
        {contrato.grupo && (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-semibold text-ink-900">Quem estuda neste contrato</h4>
            <Linhas>
              {contrato.grupo.membros.map((m) => (
                <Linha key={m.id}>
                  <Link
                    href={`/admin/alunos/${m.id}`}
                    className="text-sm font-medium text-ink-900 underline-offset-2 hover:underline"
                  >
                    {m.nome}
                  </Link>
                  <span className="text-sm text-ink-600">
                    {m.fuso}
                    {m.ancora ? ' · âncora de fuso do grupo' : ''}
                  </span>
                </Linha>
              ))}
            </Linhas>
          </div>
        )}
      </SecaoEmCaixa>

      {/* --------------------------------------------------- vigência & pausas */}
      <SecaoEmCaixa
        titulo="Vigência & pausas"
        apoio="A pausa suspende as aulas novas e congela a validade dos créditos; a retomada estende essa validade pelos dias parados. A renovação emenda os horários na virada e transfere os créditos vivos."
        acao={
          editavel ? (
            <div className="flex flex-wrap items-center gap-2">
              {travado ? (
                <AcaoTravada porque="gate-de-pendencia">Renovar</AcaoTravada>
              ) : (
                contrato.situacao === 'active' && (
                  <Link href={self({ painel: 'renovar' })} className="btn-ac-soft">
                    Renovar
                  </Link>
                )
              )}
              <Link href={self({ painel: 'pausa' })} className="btn-ac-soft">
                {contrato.situacao === 'paused' ? 'Retomar' : 'Pausar'}
              </Link>
              {travado ? (
                <AcaoTravada porque="gate-de-pendencia">Encerrar…</AcaoTravada>
              ) : (
                <Link href={self({ painel: 'encerrar' })} className="btn-danger-ghost">
                  Encerrar…
                </Link>
              )}
            </div>
          ) : undefined
        }
      >
        {travado && (
          <p
            id="gate-de-pendencia"
            className="max-w-prose rounded-input border border-warn-700/30 bg-warn-wash px-3 py-2 text-sm leading-relaxed text-ink-900"
          >
            {fraseDaPendencia(contrato.pendencias)}
          </p>
        )}
        <Pares
          itens={[
            { rotulo: 'Início da vigência', valor: contrato.vigencia.inicio },
            { rotulo: 'Fim da vigência', valor: contrato.vigencia.fim ?? 'sem data de término' },
            {
              rotulo: 'Renovado de',
              valor: contrato.renovacao.de ? (
                <Link
                  href={enderecoDoContrato(contrato.renovacao.de.id)}
                  className="underline-offset-2 hover:underline"
                >
                  {contrato.renovacao.de.plano}
                </Link>
              ) : null,
            },
            {
              rotulo: 'Renovado para',
              valor: contrato.renovacao.para ? (
                <Link
                  href={enderecoDoContrato(contrato.renovacao.para.id)}
                  className="underline-offset-2 hover:underline"
                >
                  {contrato.renovacao.para.plano}
                </Link>
              ) : null,
            },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold text-ink-900">Pausas</h4>
          {contrato.pausas.length === 0 ? (
            <p className="text-sm text-ink-600">Este contrato nunca foi pausado.</p>
          ) : (
            <Linhas>
              {contrato.pausas.map((p) => (
                <Linha key={`${p.de}-${p.ate ?? 'aberta'}`}>
                  <span className="text-sm font-medium text-ink-900">
                    {p.aberta ? `pausado desde ${p.de}` : `de ${p.de} a ${p.ate}`}
                  </span>
                  {p.aberta && <Pill tone="warn">em curso</Pill>}
                </Linha>
              ))}
            </Linhas>
          )}
        </div>
      </SecaoEmCaixa>

      {/* ------------------------------------------------------ horários fixos */}
      <SecaoEmCaixa
        titulo="Horários fixos"
        apoio={`Hora no fuso que rege este contrato (${contrato.fusoDoHorario.rotulo}). Trocar um horário fecha o antigo, cancela as aulas futuras dele (sem crédito) e materializa o novo.`}
        acao={
          editavel ? (
            // c12 · nº 6: com o fuso no palpite a porta fica FECHADA e dizendo
            // por quê — não adianta abrir um Sheet que o `create_slot` recusa.
            fusoNoPalpite ? (
              <AcaoTravada porque="gate-do-fuso">Novo horário</AcaoTravada>
            ) : (
              <Link href={self({ painel: 'horario-novo' })} className="btn-ac-soft">
                Novo horário
              </Link>
            )
          ) : undefined
        }
      >
        {fusoNoPalpite && (
          <p
            id="gate-do-fuso"
            className="max-w-prose rounded-input border border-warn-700/30 bg-warn-wash px-3 py-2 text-sm leading-relaxed text-ink-900"
          >
            {MOTIVO_DO_FUSO}
          </p>
        )}
        {contrato.horarios.length === 0 ? (
          <p className="text-sm text-ink-600">
            Nenhum horário fixo vigente — as aulas deste contrato são marcadas uma a uma.
          </p>
        ) : (
          <Linhas>
            {contrato.horarios.map((h) => (
              <Linha key={h.id}>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink-900 first-letter:uppercase">
                    {h.texto}
                  </span>
                  {h.professora && (
                    <span className="text-sm text-ink-600">
                      {h.professora} para {contrato.professora.nome ?? 'a professora'}
                    </span>
                  )}
                </span>
                {editavel &&
                  (fusoNoPalpite ? (
                    <AcaoTravada porque="gate-do-fuso">Mudar</AcaoTravada>
                  ) : (
                    <Lapis href={self({ painel: 'horario-trocar', alvo: h.id })} rotulo="Mudar" />
                  ))}
              </Linha>
            ))}
          </Linhas>
        )}

        {contrato.horariosFechados.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-semibold text-ink-900">Horários encerrados</h4>
            <Linhas>
              {contrato.horariosFechados.map((h) => (
                <Linha key={h.id}>
                  <span className="text-sm font-medium text-ink-900 first-letter:uppercase">
                    {h.texto}
                  </span>
                  <span className="text-sm text-ink-600">até {h.encerradoEm}</span>
                </Linha>
              ))}
            </Linhas>
          </div>
        )}
      </SecaoEmCaixa>

      {/* ----------------------------------------------------------- créditos */}
      <SecaoEmCaixa
        titulo="Créditos"
        apoio="Saldo derivado do ledger (Lei 2: lançamentos, nunca uma coluna de saldo). O ajuste manual vira lançamento auditado, com motivo obrigatório."
        acao={
          editavel ? <Lapis href={self({ painel: 'credito' })} rotulo="Ajustar" /> : undefined
        }
      >
        <Pares
          itens={[
            {
              rotulo: 'Créditos válidos',
              // Zero é informação urgente (régua da casa): o saldo vazio se lê
              // com o mesmo peso do saldo cheio.
              valor:
                contrato.creditos.saldo != null ? (
                  <span className="tabular-nums">{contrato.creditos.saldo}</span>
                ) : (
                  'contrato encerrado — o saldo foi destinado no encerramento'
                ),
            },
            { rotulo: 'Próximo vencimento', valor: contrato.creditos.proximaValidade },
          ]}
        />
        {contrato.creditos.verEm && (
          <Link href={contrato.creditos.verEm} className="btn-ac-soft self-start">
            Ver créditos do aluno
          </Link>
        )}
      </SecaoEmCaixa>

      {/* --------------------------------------------------------- assinatura */}
      {/* ADR-029 §1: sem a chave do Autentique no ambiente, esta seção mostra SÓ
          o aviso — nenhum botão, nenhum painel, nenhuma lista. Não é tela
          "desabilitada", é tela que não promete: o motor está no banco e volta
          inteiro quando o gate 🔑 abrir. */}
      <SecaoEmCaixa
        titulo="Assinatura"
        apoio={
          assinaturaLigada
            ? 'O documento é criado no Autentique e espelhado aqui. O estado só avança pela consulta (a admin nunca reescreve história de assinatura na mão). Uma reserva ABERTA é um pedido que começou e não se sabe se virou documento: confira no painel do Autentique e resolva por aqui.'
            : 'Esta seção fica em silêncio até a chave do Autentique existir no ambiente.'
        }
        acao={
          editavel && assinaturaLigada ? (
            <Link href={self({ painel: 'assinatura' })} className="btn-ac-soft">
              Enviar para assinatura
            </Link>
          ) : undefined
        }
      >
        {!assinaturaLigada ? (
          <p
            id="gate-do-autentique"
            className="max-w-prose rounded-input border border-warn-700/30 bg-warn-wash px-3 py-2 text-sm leading-relaxed text-ink-900"
          >
            {AVISO_DA_ASSINATURA_DESLIGADA}
          </p>
        ) : contrato.assinaturas.length === 0 ? (
          <p className="text-sm text-ink-600">
            Nenhum documento enviado para assinatura neste contrato.
          </p>
        ) : (
          <Linhas>
            {contrato.assinaturas.map((a) => (
              <Linha key={a.id}>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink-900">{a.rotulo}</span>
                  {/* c15 · Sol 8: o carimbo só aparece quando existe documento.
                      A reserva (aberta ou morta) mostra QUANDO O PEDIDO COMEÇOU,
                      com esse nome — antes as duas exibiam "enviado em <hora do
                      clique>", que é data de um envio que não aconteceu.

                      c16 · r6 nº 8: e a palavra virou "vinculado em". O carimbo
                      é o de `admin_finish_signature`, que serve o envio
                      automático E o anexo humano do id — no segundo caso a hora
                      é a do ANEXO, e o envio tinha acontecido antes, sem que
                      ninguém saiba quando. "Vinculado em" é verdade nos dois; a
                      distinção que faltaria para dizer "enviado" o banco não
                      guarda. */}
                  <span className="text-sm text-ink-600">
                    {a.vinculadaEm
                      ? `vinculado em ${a.vinculadaEm}`
                      : `pedido aberto em ${a.reservadaEm}`}
                    {a.assinadaEm ? ` · assinado em ${a.assinadaEm}` : ''}
                  </span>
                </span>
                {/* c15 · decisão B: a reserva ABERTA é o único estado que pede
                    decisão humana, e a tela oferece as duas — nem uma nem outra
                    acontece sozinha, porque o fato que falta (o documento existe
                    lá fora?) está no painel do Autentique, não aqui. */}
                {a.reservaAberta && editavel && (
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={self({ painel: 'reserva-anexar', alvo: a.id })}
                      className="btn-ac-soft"
                    >
                      Anexar id do documento
                    </Link>
                    <Link
                      href={self({ painel: 'reserva-cancelar', alvo: a.id })}
                      className="btn-ac-soft"
                    >
                      Cancelar reserva
                    </Link>
                  </span>
                )}
                {!a.terminal && !a.reservaAberta && editavel && (
                  <Link
                    // `?? undefined` é formalidade: `terminal` já é verdadeiro
                    // quando não há documento (c14), então este ramo não roda
                    // sem id — mas o tipo não sabe disso.
                    href={self({ painel: 'assinatura', alvo: a.documento ?? undefined })}
                    className="btn-ac-soft"
                  >
                    Ver status
                  </Link>
                )}
              </Linha>
            ))}
          </Linhas>
        )}
      </SecaoEmCaixa>
    </>
  )
}
