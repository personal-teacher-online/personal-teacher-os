// AS CINCO ABAS DA FICHA (Onda 1 · M3-2) — o conteúdo da ficha velha (887
// linhas de JSX com query no meio) redistribuído, sem perder um fluxo.
//
//   Visão geral        identidade · contato e acesso · convite · LGPD
//   Contrato & horários contratos vivos (horários, vigência, valores, pausas),
//                       encerrados, pagador e cobranças
//   Créditos            saldo por contrato · fila viva (com EXTENSÃO DE
//                       VALIDADE, que voltou) · extrato do ledger
//   Briefing & plano    Kolb, respostas, retaguarda, lembrete e cobertura
//   Histórico           próximas aulas e as últimas, com desfecho e apontamento
//
// Tudo aqui é SERVER: nenhum dado é buscado (chega pronto de `getStudentFile`),
// nenhuma data é formatada, e as mutações continuam sendo as MESMAS actions da
// ficha velha — o que mudou foi a moldura (Sheet do kit, aberto por `?painel=`).
import Link from 'next/link'

import { EmptyState } from '@/components/kit/empty-state'
import { InstanteTexto } from '@/components/kit/instant'
import { Pill } from '@/components/kit/pill'
import { RegistrarDesfecho } from '@/components/admin/inicio/RegistrarDesfecho'
import { TEACHER_FILL } from '@/components/ui'
import { enderecoDoNovoContrato } from '@/data/admin/contrato-novo'
import { enderecoDaFicha } from '@/data/admin/ficha-gramatica'
import type { AulaNaFicha, ContratoNaFicha, FichaDoAluno } from '@/data/admin/ficha'
import {
  adminGeneratePlanAction,
  finishAuthBlockAction,
  resendInviteAction,
  sendBriefingReminderAction,
  sendBriefingUpdateReminderAction,
  setPayerRelationshipAction,
  unlinkPayerAction,
} from '@/app/admin/alunos/actions'
import { AtualizacoesDoBriefing, HistoricoDeRevisoes, RespostasDoBriefing } from './briefing-leitura'
import { Lapis, Linha, Linhas, Pares, Secao } from './pecas'

/* ========================================================================== */
/* Visão geral                                                                 */
/* ========================================================================== */

export function AbaVisaoGeral({ ficha }: { ficha: FichaDoAluno }) {
  return (
    <>
      <Secao
        titulo="Identidade"
        acao={<Lapis href={enderecoDaFicha(ficha.id, { painel: 'editar' })} rotulo="Editar cadastro" />}
      >
        <Pares
          itens={[
            { rotulo: 'Nome', valor: ficha.nome },
            { rotulo: 'Nível', valor: ficha.nivel ?? 'ainda não avaliado' },
            // M3-c5 · D1: os três campos novos do cadastro. Nascimento e "como
            // conheceu" são opcionais SEMPRE (inclusive para criança) — vazio
            // vira "—" pela régua dos Pares, que é a ausência dita em voz alta.
            { rotulo: 'Tipo de aluno', valor: ficha.tipoRotulo },
            { rotulo: 'Nascimento', valor: ficha.nascimento },
            { rotulo: 'Como conheceu a escola', valor: ficha.comoConheceu, largo: true },
            { rotulo: 'Onde vive', valor: ficha.cidade },
            {
              rotulo: 'Fuso do aluno',
              valor: (
                <>
                  {ficha.tzRotulo} · agora são{' '}
                  <span className="tabular-nums">{ficha.horaLocal}</span> lá
                </>
              ),
            },
            { rotulo: 'Situação', valor: ficha.situacaoRotulo },
            {
              rotulo: 'Produtos',
              // Vazio HONESTO (ciclo de vida, fase 1): quem não tem contrato
              // vivo — lead, experimental sem fechar, ex-aluno entre contratos —
              // não "faz aulas particulares". Ausência vira "—" pela régua dos
              // Pares, e a linha continua na grade dizendo que está vazia.
              valor: ficha.temMentoria
                ? 'Aulas particulares e Personal Travel'
                : ficha.contratos.length > 0
                  ? 'Aulas particulares'
                  : null,
            },
          ]}
        />
      </Secao>

      {/* A5/L5 (Sol · rodada 2): o `apoio` desta seção dizia "tem número →
          recebe", e isso promete ENTREGA. O que o sistema faz é REGISTRAR o aviso
          para envio pelo canal; se ele saiu, vê-se em Avisos. */}
      <Secao
        titulo="Contato e acesso"
        apoio="O e-mail é o login do portal; o WhatsApp é o canal dos avisos (com número no cadastro, o aviso também sai por lá)."
        acao={
          ficha.temLogin ? (
            <Lapis href={enderecoDaFicha(ficha.id, { painel: 'whatsapp' })} rotulo="Editar WhatsApp" />
          ) : ficha.ehLead ? (
            // Ciclo de vida, fase 1: LEAD NÃO TEM PORTAL. Oferecer o convite
            // aqui seria oferecer um gesto que a decisão da spec não quer que
            // aconteça — o acesso nasce com o contrato.
            undefined
          ) : (
            <Link href={enderecoDaFicha(ficha.id, { painel: 'convidar' })} className="btn-ac">
              Convidar para o portal
            </Link>
          )
        }
      >
        <Pares
          itens={[
            {
              rotulo: 'E-mail',
              valor: (
                <>
                  {ficha.email ?? '—'}
                  {ficha.emailDevolvido && (
                    <span className="ml-2 font-semibold text-danger-700">e-mail devolvido</span>
                  )}
                </>
              ),
            },
            {
              rotulo: 'WhatsApp',
              valor: ficha.whatsapp ? (
                <>
                  {ficha.whatsapp}
                  {/* "recebe avisos" prometia entrega; o que se sabe é que o
                      canal está LIGADO para este aluno. */}
                  <span className="ml-2 font-normal text-ink-600">canal de avisos ligado</span>
                </>
              ) : (
                'sem número — só e-mail'
              ),
            },
            {
              rotulo: 'Ciência do canal',
              valor: ficha.cienciaDoCanal ? `aceita desde ${ficha.cienciaDoCanal}` : null,
            },
            {
              rotulo: 'Acesso ao portal',
              valor: (
                <span className="flex flex-wrap items-center gap-2">
                  {ficha.acesso === 'ativo'
                    ? 'ativo'
                    : ficha.acesso === 'pendente'
                      ? 'convite pendente'
                      : 'sem convite'}
                  {ficha.acesso === 'pendente' && (
                    <form action={resendInviteAction}>
                      <input type="hidden" name="student_id" value={ficha.id} />
                      <button type="submit" className="btn-ac-soft">
                        Reenviar convite
                      </button>
                    </form>
                  )}
                </span>
              ),
            },
            { rotulo: 'Convidado em', valor: ficha.convidadoEm },
            { rotulo: 'Último acesso', valor: ficha.ultimoAcesso },
          ]}
        />
      </Secao>

      {/* NOTA INTERNA (M3-c5 · D1) — o único bloco da ficha que a tela promete
          que o aluno nunca lê, e a promessa é cumprida no BANCO: tabela própria
          (`student_notes`) sem policy de aluno. O rótulo diz isso em voz alta,
          porque quem escreve aqui precisa saber onde está escrevendo. */}
      <Secao
        titulo="Nota interna"
        apoio="Visível só para a equipe — nunca para o aluno. É o bilhete da ficha: o que a próxima pessoa que atender precisa saber."
        acao={
          <Lapis
            href={enderecoDaFicha(ficha.id, { painel: 'nota' })}
            rotulo={ficha.notaInterna ? 'Editar nota' : 'Escrever nota'}
          />
        }
      >
        {ficha.notaInterna ? (
          <>
            <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line text-ink-900">
              {ficha.notaInterna.texto}
            </p>
            <p className="text-sm text-ink-600">atualizada em {ficha.notaInterna.quando}</p>
          </>
        ) : (
          <p className="text-sm text-ink-600">Nenhuma nota escrita sobre este aluno.</p>
        )}
      </Secao>

      <Secao
        titulo="Dados & LGPD"
        apoio="Exportar entrega tudo o que a escola guarda deste aluno. Anonimizar é irreversível e exige todos os contratos encerrados."
      >
        {/* S1: pendência de bloqueio — a ficha foi anonimizada, o login não. */}
        {ficha.bloqueioDeLoginPendente && (
          <div className="flex flex-col gap-2 rounded-input border border-danger-700/40 bg-danger-700/5 p-4">
            <p className="text-sm font-semibold text-danger-700">
              Anonimização pela metade: o login desta pessoa AINDA está ativo.
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-ink-600">
              A ficha já foi desidentificada, mas a destruição do acesso (feita no serviço de login,
              fora do banco) falhou. Enquanto este aviso estiver aqui, a pessoa consegue entrar no
              portal. Pode clicar quantas vezes precisar — repetir não faz mal.
            </p>
            <form action={finishAuthBlockAction}>
              <input type="hidden" name="student_id" value={ficha.id} />
              <button type="submit" className="btn-ac">
                Concluir bloqueio de login
              </button>
            </form>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <a href={`/admin/alunos/${ficha.id}/export`} download className="btn-ac-soft">
            Exportar dados (JSON)
          </a>
          {/* B6 · item 1: com contrato vivo, a RPC RECUSA ("aluno ainda tem
              contrato não-encerrado"). Oferecer o botão era mandar a pessoa
              digitar o nome inteiro para ouvir "não" no fim — e sem dizer o que
              falta encerrar. O gesto some e a frase diz QUAIS contratos são. */}
          {ficha.contratos.length === 0 ? (
            <Link
              href={enderecoDaFicha(ficha.id, { painel: 'anonimizar' })}
              className="btn-danger-ghost"
            >
              Anonimizar ex-aluno…
            </Link>
          ) : (
            <p className="max-w-prose text-sm leading-relaxed text-ink-600">
              Ainda não dá para anonimizar:{' '}
              {ficha.contratos.length === 1 ? 'o contrato' : 'os contratos'}{' '}
              <span className="font-medium text-ink-900">
                {ficha.contratos.map((c) => c.plano).join(', ')}
              </span>{' '}
              {ficha.contratos.length === 1 ? 'continua' : 'continuam'} em aberto. Encerre em
              Contratos e volte aqui.
            </p>
          )}
        </div>
      </Secao>
    </>
  )
}

/* ========================================================================== */
/* Contrato & horários                                                         */
/* ========================================================================== */

function BlocoDeContrato({ contrato, fichaId }: { contrato: ContratoNaFicha; fichaId: string }) {
  return (
    <Secao
      titulo={contrato.plano}
      acao={
        <Link href={contrato.gerirEm} className="btn-ac-soft">
          Gerir em {contrato.tipo === 'mentorship' ? 'Mentoria' : 'Contratos'}
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={contrato.situacaoTom}>{contrato.situacaoRotulo}</Pill>
        <Pill tone={contrato.tipo === 'mentorship' ? 'ac' : 'neutral'}>{contrato.produto}</Pill>
        {contrato.experimental && <Pill tone="warn">aula experimental</Pill>}
        {contrato.turma && <Pill tone="neutral">turma {contrato.turma}</Pill>}
      </div>

      <Pares
        itens={[
          {
            rotulo: 'Professora',
            valor: contrato.professora.nome ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${TEACHER_FILL[contrato.professora.idx % TEACHER_FILL.length]}`}
                />
                {contrato.professora.nome}
              </span>
            ) : null,
          },
          { rotulo: 'Valor da hora', valor: contrato.valorHora },
          { rotulo: 'Início da vigência', valor: contrato.vigencia.inicio },
          { rotulo: 'Fim da vigência', valor: contrato.vigencia.fim ?? 'sem data de término' },
          {
            rotulo: 'Remarcações por mês',
            valor: contrato.politica.remarcacoes != null ? String(contrato.politica.remarcacoes) : null,
          },
          {
            rotulo: 'Aviso mínimo',
            valor: contrato.politica.avisoHoras != null ? `${contrato.politica.avisoHoras} h` : null,
          },
          {
            rotulo: 'Validade do crédito',
            valor: contrato.politica.validadeDias != null ? `${contrato.politica.validadeDias} dias` : null,
            largo: true,
          },
        ]}
      />

      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-semibold text-ink-900">Horários fixos</h4>
        {contrato.horarios.length === 0 ? (
          <p className="text-sm text-ink-600">
            Nenhum horário fixo ativo — as aulas deste contrato são marcadas uma a uma.
          </p>
        ) : (
          <Linhas>
            {contrato.horarios.map((h) => (
              <Linha key={h.id}>
                <span className="text-sm font-medium text-ink-900">{h.aluno}</span>
                {h.professora && (
                  <span className="text-sm text-ink-600">
                    {h.professora} para {contrato.professora.nome ?? 'a professora'}
                  </span>
                )}
              </Linha>
            ))}
          </Linhas>
        )}
      </div>

      {contrato.pausas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold text-ink-900">Pausas</h4>
          <ul className="flex flex-col gap-1 text-sm text-ink-900">
            {contrato.pausas.map((p) => (
              <li key={`${p.de}-${p.ate ?? 'aberta'}`}>
                {p.aberta ? (
                  <>
                    pausado desde {p.de} <Pill tone="warn">em curso</Pill>
                  </>
                ) : (
                  `de ${p.de} a ${p.ate}`
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* M3-c3 · A4: era link de texto com seta escrita — o padrão que o dono
          baniu. Vira botão do kit; o saldo continua no rótulo, entre
          parênteses, porque é ele que faz alguém clicar. */}
      <Link href={enderecoDaFicha(fichaId, { aba: 'creditos' })} className="btn-ac-soft self-start">
        {contrato.saldo != null ? `Ver créditos (${contrato.saldo})` : 'Ver créditos'}
      </Link>
    </Secao>
  )
}

export function AbaContrato({ ficha }: { ficha: FichaDoAluno }) {
  return (
    <>
      {ficha.contratos.length === 0 ? (
        <Secao titulo="Contratos">
          <EmptyState
            illustration="/illustrations/aula-online.svg"
            title="Nenhum contrato para este aluno."
            hint="Sem contrato não há aulas: crie um ligando aluno, professora e plano — os horários fixos nascem junto."
            cta="Criar contrato"
            // M4-4: o wizard (`/admin/contratos/novo`), não a lista velha.
            href={enderecoDoNovoContrato('individual')}
          />
        </Secao>
      ) : (
        ficha.contratos.map((c) => <BlocoDeContrato key={c.id} contrato={c} fichaId={ficha.id} />)
      )}

      {ficha.encerrados.length > 0 && (
        <Secao
          titulo={`Contratos encerrados (${ficha.encerrados.length})`}
          apoio="Encerrado não é inexistente: o histórico continua respondendo por aulas, créditos e cobranças passadas."
        >
          <Linhas>
            {ficha.encerrados.map((c) => (
              <Linha key={c.id}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-900">{c.plano}</span>
                  <Pill tone="muted">{c.produto}</Pill>
                  {c.professora.nome && <span className="text-sm text-ink-600">{c.professora.nome}</span>}
                </span>
                <span className="text-sm text-ink-600">
                  {c.vigencia.inicio ?? '—'} → {c.vigencia.fim ?? '—'}
                </span>
              </Linha>
            ))}
          </Linhas>
        </Secao>
      )}

      <Secao
        titulo="Pagador"
        apoio="“É o próprio aluno” libera o botão da fatura no portal — a fatura do Asaas mostra nome e documento do pagador, então fatura de terceiro nunca aparece lá. O vínculo é pré-requisito da conciliação e da anonimização."
        acao={<Lapis href={enderecoDaFicha(ficha.id, { painel: 'pagador' })} rotulo="Vincular pagador" />}
      >
        {ficha.pagadores.length === 0 ? (
          <p className="text-sm text-ink-600">
            Nenhum pagador vinculado — o próprio aluno paga, ou vincule um responsável.
          </p>
        ) : (
          <Linhas>
            {ficha.pagadores.map((p) => (
              <Linha key={p.id}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-900">{p.nome}</span>
                  {p.email && <span className="text-sm text-ink-600">{p.email}</span>}
                  {p.noAsaas && <Pill tone="ac">no Asaas</Pill>}
                  {/* self × terceiro é DADO de segurança (decide o link da fatura) */}
                  <Pill tone={p.self ? 'ok' : 'neutral'}>
                    {p.self ? 'é o próprio aluno' : 'terceiro'}
                  </Pill>
                </span>
                <span className="flex items-center gap-2">
                  <form action={setPayerRelationshipAction}>
                    <input type="hidden" name="student_id" value={ficha.id} />
                    <input type="hidden" name="payer_id" value={p.id} />
                    <input type="hidden" name="relationship" value={p.self ? 'terceiro' : 'self'} />
                    <button type="submit" className="btn-ac-ghost">
                      {p.self ? 'Marcar como terceiro' : 'Marcar como o próprio aluno'}
                    </button>
                  </form>
                  <form action={unlinkPayerAction}>
                    <input type="hidden" name="student_id" value={ficha.id} />
                    <input type="hidden" name="payer_id" value={p.id} />
                    <button type="submit" className="btn-danger-ghost">
                      Desvincular
                    </button>
                  </form>
                </span>
              </Linha>
            ))}
          </Linhas>
        )}
      </Secao>

      <Secao titulo="Cobranças" apoio="As doze últimas cobranças dos contratos deste aluno.">
        {ficha.cobrancas.length === 0 ? (
          <p className="text-sm text-ink-600">Nenhuma cobrança registrada para este aluno ainda.</p>
        ) : (
          <Linhas>
            {ficha.cobrancas.map((c) => (
              <Linha key={c.id}>
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium text-ink-900">{c.competencia}</span>
                  <span className="text-sm text-ink-600">vence {c.vencimento}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums text-ink-900">{c.valor}</span>
                  <Pill tone={c.tom}>{c.situacao}</Pill>
                </span>
              </Linha>
            ))}
          </Linhas>
        )}
      </Secao>
    </>
  )
}

/* ========================================================================== */
/* Créditos                                                                    */
/* ========================================================================== */

export function AbaCreditos({ ficha }: { ficha: FichaDoAluno }) {
  const { creditos } = ficha

  return (
    <>
      <Secao
        titulo="Saldo"
        apoio="Disponíveis são os que dá para agendar hoje; agendados já estão reservados numa reposição futura."
      >
        <Pares
          itens={[
            { rotulo: 'Disponíveis', valor: String(creditos.disponiveis) },
            { rotulo: 'Agendados', valor: String(creditos.agendados) },
            { rotulo: 'Total', valor: String(creditos.total) },
            {
              rotulo: 'Validade mais próxima',
              valor: creditos.proximaValidade ? (
                <Pill tone={creditos.tomDaValidade}>
                  {/* A6/lote 3: com o contrato pausado a contagem PAROU — nem
                      "vale até" (o dia não mata mais o crédito) nem "venceu em"
                      (ele não venceu). A palavra é a mesma do portal. */}
                  {creditos.validadeCongelada
                    ? 'valia até'
                    : creditos.tomDaValidade === 'danger'
                      ? 'venceu em'
                      : 'vale até'}{' '}
                  {creditos.proximaValidade}
                  {creditos.validadeCongelada && ' — contagem parada'}
                </Pill>
              ) : null,
            },
          ]}
        />
      </Secao>

      <Secao
        titulo="Créditos"
        apoio="Cada crédito é um lançamento com validade e duração próprias (Lei 2) — por isso a extensão age em um de cada vez, com motivo obrigatório e auditoria. Crédito já vencido aparece como registro, sem ação: estender é empurrar para frente o que ainda vale; devolver o que a política já matou é ajuste manual. Com o contrato PAUSADO a contagem fica parada e não há extensão manual: quem devolve os dias parados é a retomada."
      >
        {creditos.vivos.length === 0 ? (
          <p className="text-sm text-ink-600">
            {/* A5/L5 (Sol · rodada 2, grave): "nascem quando a escola cancela uma
                aula" é lista incompleta — crédito de reposição nasce de
                cancelamento pela escola, de FALTA DA PROFESSORA
                (`_mark_no_show` com `p_who='teacher'`) e de AJUSTE MANUAL
                (`admin_makeup_adjust` com `p_delta > 0`), e o extrato ainda pode
                mostrar saldo trazido e devolução. Mesma classe do "só aparece"
                que o portal acabou de perder. */}
            Nenhum crédito de reposição no saldo. Eles nascem quando a escola desmarca uma aula,
            quando a professora falta, ou quando a escola lança um ajuste.
          </p>
        ) : (
          <Linhas>
            {creditos.vivos.map((c) => (
              <Linha key={c.ledgerId}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-900">1 crédito</span>
                  {/* A6/lote 3 (prova independente L3): o crédito de contrato
                      PAUSADO estava sendo classificado por `expires_on` cru — e
                      aparecia "venceu em 12/08", em vermelho, enquanto o portal
                      do aluno mostrava o MESMO crédito como "contagem parada".
                      Congelado tem situação própria, com tom neutro e a palavra
                      do portal. */}
                  <Pill
                    tone={
                      c.situacao === 'congelado'
                        ? 'muted'
                        : c.situacao === 'vencido'
                          ? 'danger'
                          : c.situacao === 'vencendo'
                            ? 'warn'
                            : 'ok'
                    }
                  >
                    {c.situacao === 'congelado'
                      ? `valia até ${c.validade} — contagem parada`
                      : `${c.situacao === 'vencido' ? 'venceu em' : 'vale até'} ${c.validade}`}
                  </Pill>
                  {c.duracaoMin && <span className="text-sm text-ink-600">aula de {c.duracaoMin} min</span>}
                </span>
                {/* S1: o lápis só existe em crédito VIVO com prazo. Vencido
                    (e o sem prazo) fica listado sem gesto — a RPC recusa, e
                    oferecer o botão seria convidar para o erro. */}
                {c.extensivel && (
                  <Lapis
                    href={enderecoDaFicha(ficha.id, { painel: 'estender', alvo: c.ledgerId })}
                    rotulo="Estender validade"
                  />
                )}
              </Linha>
            ))}
          </Linhas>
        )}
      </Secao>

      <Secao
        titulo="Extrato"
        apoio="O ledger inteiro, do mais novo para o mais antigo — append-only: nada aqui é editado ou apagado."
      >
        {creditos.extrato.length === 0 ? (
          <p className="text-sm text-ink-600">Nenhum movimento de crédito ainda.</p>
        ) : (
          <Linhas>
            {creditos.extrato.map((l) => (
              <Linha key={l.id}>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span
                    className={`text-sm font-bold tabular-nums ${l.positivo ? 'text-ok-700' : 'text-ink-600'}`}
                  >
                    {l.sinal}
                  </span>
                  <span className="text-sm text-ink-900">{l.texto}</span>
                  <span className="text-sm text-ink-600">{l.quando}</span>
                </span>
                {l.situacao && <Pill tone={l.situacao.tom}>{l.situacao.rotulo}</Pill>}
              </Linha>
            ))}
          </Linhas>
        )}
        {creditos.extratoTruncado && (
          // S4: a tela não pode afirmar um extrato completo que não é.
          <p className="text-sm text-ink-600">
            Mostrando os 100 lançamentos mais recentes — há histórico mais antigo além destes.
          </p>
        )}
      </Secao>
    </>
  )
}

/* ========================================================================== */
/* Briefing & plano                                                            */
/* ========================================================================== */

export function AbaBriefing({ ficha }: { ficha: FichaDoAluno }) {
  const b = ficha.briefing

  return (
    <>
      <Secao
        titulo="Briefing"
        apoio="O aluno responde no primeiro acesso ao portal (é bloqueante). Quando ele responde por telefone, a dona preenche em nome dele — fica auditado como dela."
        acao={
          b?.enviado ? (
            // Enviado, o briefing não se "edita": corrige-se, com motivo e
            // trilha (`admin_revise_briefing`). O Kolb fica de fora do painel —
            // é instrumento calibrado, e o banco recusa patch nele.
            <span className="flex flex-wrap items-center gap-2">
              {/* Sub-lote 5: o toque do RE-BRIEFING só aparece quando o aluno
                  veria o convite no Início dele (mesma função de decisão) e tem
                  login — sem isso o botão prometeria um e-mail que a RPC recusa. */}
              {b.atualizacaoPendente && ficha.temLogin && (
                <form action={sendBriefingUpdateReminderAction}>
                  <input type="hidden" name="student_id" value={ficha.id} />
                  <button type="submit" className="btn-ac-soft">
                    Lembrar de atualizar (e-mail/WhatsApp)
                  </button>
                </form>
              )}
              <Lapis
                href={enderecoDaFicha(ficha.id, { painel: 'briefing-correcao' })}
                rotulo="Corrigir resposta"
              />
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {ficha.temLogin && (
                <form action={sendBriefingReminderAction}>
                  <input type="hidden" name="student_id" value={ficha.id} />
                  <button type="submit" className="btn-ac-soft">
                    Lembrar por e-mail/WhatsApp
                  </button>
                </form>
              )}
              <Lapis
                href={enderecoDaFicha(ficha.id, { painel: 'briefing' })}
                rotulo="Preencher em nome do aluno"
              />
            </span>
          )
        }
      >
        {b?.enviado ? (
          <>
            <Pares
              itens={[
                { rotulo: 'Estilo de aprendizagem (Kolb)', valor: b.estilo?.nome },
                { rotulo: 'Enviado em', valor: b.enviadoEm },
                { rotulo: 'Como ele aprende', valor: b.estilo?.leitura, largo: true },
                {
                  rotulo: 'Pontuações',
                  valor: b.pontuacoes.length
                    ? b.pontuacoes.map((p) => `${p.sigla} ${p.valor}`).join(' · ')
                    : null,
                  largo: true,
                },
              ]}
            />
            {/* As respostas por extenso: a PERGUNTA vem do dicionário, na
                versão da própria linha, e a rotina volta a ser grade. O
                `<details>` com as chaves cruas do jsonb morreu aqui. */}
            <RespostasDoBriefing briefing={b} />
          </>
        ) : (
          <p className="text-sm leading-relaxed text-warn-700">
            {b?.rascunho ? 'Rascunho iniciado — ainda não enviado.' : 'Ainda não respondido.'}{' '}
            <span className="text-ink-600">
              Sem briefing não há plano de estudos: o portal cobra a resposta antes de qualquer outra
              coisa.
            </span>
          </p>
        )}
      </Secao>

      {/* O RE-BRIEFING SEMESTRAL enviado (achado 6 da revisão de integração).
          Não é correção do base: é a resposta nova do aluno para objetivos e
          interesses NAQUELE ciclo — e é ela que o plano do semestre leu. */}
      {b && b.atualizacoes.length > 0 && (
        <Secao
          titulo="Atualizações semestrais"
          apoio="O que o aluno respondeu de novo em objetivos e interesses a cada semestre. Substituem a seção INTEIRA no briefing efetivo daquele ciclo — o briefing original fica intacto acima."
        >
          <AtualizacoesDoBriefing atualizacoes={b.atualizacoes} />
        </Secao>
      )}

      {/* Só existe quando alguém corrigiu: seção vazia diria que há trilha onde
          não há. O briefing continua imutável no sentido que importa — todo
          estado anterior é reconstruível por aqui (motivo + de/para + snapshot). */}
      {b && b.revisoes.length > 0 && (
        <Secao
          titulo="Histórico de revisões"
          apoio="Cada correção feita depois do envio, da mais recente para a mais antiga. A trilha é append-only: nada aqui é editado ou apagado."
        >
          <HistoricoDeRevisoes revisoes={b.revisoes} versao={b.versao} />
        </Secao>
      )}

      <Secao
        titulo="Plano de estudos"
        apoio="A personalização (temas, abordagem, aulas Flexge) é feita pela professora no painel dela."
      >
        {ficha.plano ? (
          <>
            <Pares
              itens={[
                { rotulo: 'Semestre', valor: String(ficha.plano.semestre) },
                { rotulo: 'Nível na geração', valor: ficha.plano.nivel },
                {
                  rotulo: 'Cobertura',
                  valor: `${ficha.plano.aplicados}/${ficha.plano.total} módulos aplicados em aula`,
                  largo: true,
                },
              ]}
            />
            <ul className="flex flex-col gap-1">
              {ficha.plano.itens.map((i) => (
                <li key={i.id} className="flex items-baseline gap-2 text-sm">
                  <span className="tabular-nums text-ink-600">{i.posicao}.</span>
                  <span className="min-w-0 text-ink-900">
                    {i.titulo}
                    {i.tema && <span className="text-ink-600"> — {i.tema}</span>}
                  </span>
                  {i.aplicado && <Pill tone="ok">aplicado</Pill>}
                </li>
              ))}
            </ul>
          </>
        ) : ficha.contratoParaPlano ? (
          ficha.nivel ? (
            <form action={adminGeneratePlanAction} className="flex flex-col items-start gap-2">
              <p className="text-sm text-ink-600">Sem plano ainda para este semestre.</p>
              <input type="hidden" name="student_id" value={ficha.id} />
              <input type="hidden" name="contract_id" value={ficha.contratoParaPlano} />
              <button type="submit" className="btn-ac">
                Gerar plano do semestre ({ficha.nivel})
              </button>
            </form>
          ) : (
            <p className="text-sm text-warn-700">
              Defina o NÍVEL do aluno (Editar cadastro, na Visão geral) para gerar o plano da trilha.
            </p>
          )
        ) : (
          <p className="text-sm text-ink-600">Sem contrato particular ativo — não há plano a gerar.</p>
        )}
      </Secao>
    </>
  )
}

/* ========================================================================== */
/* Histórico                                                                   */
/* ========================================================================== */

function LinhaDeAula({
  aula,
  fichaId,
  futura,
}: {
  aula: AulaNaFicha
  fichaId: string
  /**
   * B6 · item 5 — SÓ a lista de próximas passa `futura`, e "próxima" já quer
   * dizer "ainda não começou" (`getStudentFile` corta em `starts_at_utc >=
   * agora`). É por isso que remarcar e cancelar não aparecem em aula que já
   * começou: cancelar o que já aconteceu não é cancelamento, é desfecho — e
   * desfecho tem gesto próprio (`RegistrarDesfecho`, logo abaixo).
   */
  futura?: boolean
}) {
  return (
    <Linha>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <InstanteTexto
          value={aula.instante}
          className="text-sm font-semibold tabular-nums text-ink-900 first-letter:uppercase"
        />
        {aula.horaDoAluno && (
          <span className="text-sm text-ink-600">
            <span className="tabular-nums">{aula.horaDoAluno}</span> para o aluno
          </span>
        )}
        {aula.professora.nome && (
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-600">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${TEACHER_FILL[aula.professora.idx % TEACHER_FILL.length]}`}
            />
            {aula.professora.nome}
          </span>
        )}
        {aula.apontamento && <span className="text-sm text-ink-600">· {aula.apontamento}</span>}
      </span>

      <span className="flex flex-wrap items-center gap-2">
        <Pill tone={aula.situacaoTom}>{aula.situacaoRotulo}</Pill>
        {futura && (
          <>
            <Link href={`/admin/agenda/remarcar/${aula.id}`} className="btn-ac-soft">
              Remarcar
            </Link>
            <Link
              href={enderecoDaFicha(fichaId, { painel: 'cancelar', alvo: aula.id })}
              className="btn-danger-ghost"
            >
              Cancelar…
            </Link>
          </>
        )}
        {aula.semDesfecho && (
          <RegistrarDesfecho
            instanceId={aula.id}
            quem={aula.quem}
            instante={aula.instante}
            revalidar={`/admin/alunos/${fichaId}`}
          />
        )}
      </span>
    </Linha>
  )
}

export function AbaHistorico({ ficha }: { ficha: FichaDoAluno }) {
  return (
    <>
      <Secao titulo="Próximas aulas" apoio="Nos horários de Cuiabá — os seus.">
        {ficha.aulas.proximas.length === 0 ? (
          <EmptyState
            illustration="/illustrations/agenda-vazia.svg"
            title="Nenhuma aula agendada."
            hint="As aulas nascem do horário fixo do contrato, ou de uma reposição marcada pelo aluno no portal."
            cta="Ver a agenda da semana"
            href="/admin/agenda"
          />
        ) : (
          <Linhas>
            {ficha.aulas.proximas.map((a) => (
              <LinhaDeAula key={a.id} aula={a} fichaId={ficha.id} futura />
            ))}
          </Linhas>
        )}
      </Secao>

      <Secao
        titulo="Últimas aulas"
        apoio="O que já passou, com o desfecho e o que foi trabalhado (o apontamento da professora)."
      >
        {ficha.aulas.passadas.length === 0 ? (
          <p className="text-sm text-ink-600">Sem histórico ainda — este aluno não teve aulas.</p>
        ) : (
          <Linhas>
            {ficha.aulas.passadas.map((a) => (
              <LinhaDeAula key={a.id} aula={a} fichaId={ficha.id} />
            ))}
          </Linhas>
        )}
      </Secao>
    </>
  )
}
