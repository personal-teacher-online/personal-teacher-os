// COLUNA ESQUERDA DA FICHA (Onda 1 · M3-2) — a clonagem do TutorBird: "esquerda:
// cards de identidade + Lesson Settings (com Make-Up Credits Booked|Available|
// Total) com lápis por card".
//
// São TRÊS cartões, nesta ordem, porque é esta a ordem das perguntas:
//   1. quem é           — avatar, nome, situação, onde vive e que horas são lá
//   2. o que ele faz    — o contrato ativo (produto, professora, horários, valor)
//   3. quanto ele tem   — os créditos de reposição, no arranjo Make-Up deles
//
// O cartão de créditos é o único lugar da ficha onde o número aparece em
// destaque: é DADO (bold, tabular), nunca display fino.
//
// AÇÃO É BOTÃO (M3-c3 · A4) — "Ver extrato →" e "Ver pagador (…) →" eram links
// de texto com seta escrita. É um padrão que o dono já tinha reprovado duas
// vezes; a captura da ficha mostrou que ele sobrevivia aqui. Os dois viraram
// `.btn-ac-soft` (a ação secundária do kit, 36px) e a seta morreu — quem leva
// a outro lugar é botão, e a direção quem dá é o rótulo. As setas que ficam no
// site são as de NAVEGAÇÃO semântica (a trilha "← Alunos") e as de tendência
// (↗ ↘ → do "vs mês anterior"), que não são ação nem link.
import Link from 'next/link'

import { Avatar } from '@/components/kit/avatar'
import { Pill, type PillTone } from '@/components/kit/pill'
import { TEACHER_FILL } from '@/components/ui'
import { ACESSO_ROTULO } from '@/data/admin/alunos-grupos'
import { enderecoDoNovoContrato } from '@/data/admin/contrato-novo'
import { enderecoDaFicha } from '@/data/admin/ficha-gramatica'
import type { ContratoNaFicha, FichaDoAluno } from '@/data/admin/ficha'
import { Lapis } from './pecas'

const ACESSO_TOM: Record<string, PillTone> = {
  ativo: 'ok',
  pendente: 'warn',
  sem_convite: 'neutral',
}

function Cartao({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`panel-tb flex flex-col gap-3 p-5 ${className}`}>{children}</div>
}

function Numero({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <div className="flex min-w-16 flex-col gap-0.5">
      <span className={`text-2xl font-bold tabular-nums ${destaque ? 'text-ac-deep' : 'text-ink-900'}`}>
        {valor}
      </span>
      <span className="text-sm text-ink-600">{rotulo}</span>
    </div>
  )
}

function ResumoDoContrato({ contrato, fichaId }: { contrato: ContratoNaFicha; fichaId: string }) {
  return (
    <Cartao>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="title-section text-ink-900">{contrato.produto}</h3>
        <Pill tone={contrato.situacaoTom}>{contrato.situacaoRotulo}</Pill>
      </div>
      <p className="text-sm font-medium text-ink-900">{contrato.plano}</p>

      {contrato.professora.nome && (
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${TEACHER_FILL[contrato.professora.idx % TEACHER_FILL.length]}`}
          />
          {contrato.professora.nome}
        </p>
      )}

      {contrato.horarios.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm text-ink-900">
          {contrato.horarios.map((h) => (
            <li key={h.id}>
              {h.aluno}
              {h.professora && (
                <span className="text-ink-600">
                  {' '}
                  = {h.professora} para {contrato.professora.nome ?? 'a professora'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="text-ink-600">Valor da hora</dt>
          <dd className="font-medium text-ink-900">{contrato.valorHora ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-600">Desde</dt>
          <dd className="font-medium text-ink-900">{contrato.vigencia.inicio ?? '—'}</dd>
        </div>
      </dl>

      {/* O lápis do contrato abre a ABA do assunto — a edição de vigência,
          pausa e valor mora em Contratos (a tela dela nasce no M4), e mandar
          para lá direto tiraria a ficha do caminho. */}
      <Lapis href={enderecoDaFicha(fichaId, { aba: 'contrato' })} rotulo="Ver contrato e horários" />
    </Cartao>
  )
}

export function ColunaDeIdentidade({ ficha }: { ficha: FichaDoAluno }) {
  const principal = ficha.contratos.find((c) => c.situacao === 'active') ?? ficha.contratos[0] ?? null

  return (
    <div className="flex flex-col gap-4">
      <Cartao>
        <div className="flex items-center gap-3">
          {/* 64px: o avatar da FICHA é maior que o da lista (36px) — é o retrato
              da pessoa, não um marcador de linha. */}
          <Avatar nome={ficha.nome} id={ficha.id} className="h-16 w-16 text-xl" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="title-section break-words text-ink-900">{ficha.nome}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* CICLO DE VIDA (fase 1) — a situação vem PRIMEIRO e SEMPRE: é
                  ela que responde "em que ponto esta pessoa está", e é a mesma
                  palavra (e cor) da badge do hub. Antes só aparecia quando o
                  cadastro estava arquivado, e a ficha de um lead não tinha como
                  se anunciar. */}
              <Pill tone="situacao" situacao={ficha.situacao}>
                {ficha.situacaoRotulo}
              </Pill>
              <Pill tone={ACESSO_TOM[ficha.acesso] ?? 'neutral'}>{ACESSO_ROTULO[ficha.acesso]}</Pill>
              {ficha.nivel && (
                <Pill tone="nivel" nivel={ficha.nivel}>
                  {ficha.nivel}
                </Pill>
              )}
              {ficha.temMentoria && <Pill tone="ac">Personal Travel</Pill>}
            </div>
          </div>
        </div>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-ink-600">Onde vive</dt>
            <dd className="font-medium text-ink-900">{ficha.cidade}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-ink-600">Hora do aluno</dt>
            <dd className="flex flex-wrap items-center gap-2 font-medium tabular-nums text-ink-900">
              {ficha.horaLocal} <span className="font-normal text-ink-600">({ficha.tzRotulo})</span>
              {/* P6 da revisão nº 8: fuso que veio do cadastro mínimo é PALPITE
                  (o da escola), e o banco recusa contrato/horário fixo enquanto
                  ele for palpite. A ficha anuncia isso onde o dado está — não
                  adianta o erro só aparecer no clique. */}
              {ficha.fusoAConfirmar && <Pill tone="warn">fuso a confirmar</Pill>}
            </dd>
          </div>
        </dl>

        {ficha.fusoAConfirmar && (
          <p className="text-sm leading-relaxed text-ink-600">
            Este cadastro nasceu sem cidade e herdou o fuso da escola. Complete cidade e fuso
            antes de criar contrato ou horário fixo — senão as aulas nascem no relógio errado.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Lapis href={enderecoDaFicha(ficha.id, { painel: 'editar' })} rotulo="Editar cadastro" />
          {ficha.pagadores.length > 0 && (
            <Link href={enderecoDaFicha(ficha.id, { aba: 'contrato' })} className="btn-ac-soft">
              Ver pagador ({ficha.pagadores[0].nome})
            </Link>
          )}
        </div>
      </Cartao>

      {principal ? (
        <ResumoDoContrato contrato={principal} fichaId={ficha.id} />
      ) : ficha.ehLead ? (
        /* CICLO DE VIDA (fase 1) — a ficha de um LEAD. O vazio é HONESTO: não
           há contrato porque ainda não há aluno, e o cartão diz isso e oferece
           as duas saídas do funil, em vez de fingir uma ficha pela metade. */
        <Cartao>
          <h3 className="title-section text-ink-900">Ainda não é aluno</h3>
          <p className="text-sm leading-relaxed text-ink-600">
            Este é um lead: sem contrato, sem aulas e sem portal. Ao criar o primeiro contrato
            dele, o cadastro vira ALUNO ATIVO sozinho — não há um segundo passo para lembrar.
          </p>
          {ficha.fusoAConfirmar && (
            <p className="text-sm leading-relaxed text-ink-600">
              Antes do contrato falta uma coisa: <strong className="text-ink-900">o fuso</strong>.
              Este cadastro herdou o da escola por não ter cidade.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {/* P6: com o fuso por confirmar, o CTA leva a COMPLETAR O CADASTRO —
                oferecer "Criar contrato" seria mandar a dona a uma tela onde o
                banco vai recusar (e com razão: o horário sairia errado). */}
            {ficha.fusoAConfirmar ? (
              <Link href={enderecoDaFicha(ficha.id, { painel: 'editar' })} className="btn-ac">
                Completar cadastro
              </Link>
            ) : (
              // M4-4: o CTA leva ao WIZARD com o tipo já escolhido. Antes era
              // `/admin/contratos?novo=individual`, a porta da tela velha.
              <Link href={enderecoDoNovoContrato('individual')} className="btn-ac">
                Criar contrato
              </Link>
            )}
            <Link href={enderecoDaFicha(ficha.id, { painel: 'perder' })} className="btn-ac-soft">
              Lead perdido
            </Link>
          </div>
        </Cartao>
      ) : (
        <Cartao>
          <h3 className="title-section text-ink-900">Sem contrato ativo</h3>
          <p className="text-sm leading-relaxed text-ink-600">
            Sem contrato não há aulas: crie um ligando aluno, professora e plano.
          </p>
          {/* M4-4: o wizard, não a lista velha — quem clica aqui quer CRIAR. */}
          <Link href={enderecoDoNovoContrato('individual')} className="btn-ac self-start">
            Criar contrato
          </Link>
        </Cartao>
      )}

      <Cartao>
        {/* `items-center`, não `items-baseline`: o alinhamento por linha de base
            valia para um link de texto; com o botão do kit ao lado do título
            quem alinha é o eixo do bloco. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 className="title-section text-ink-900">Créditos de reposição</h3>
          <Link href={enderecoDaFicha(ficha.id, { aba: 'creditos' })} className="btn-ac-soft">
            Ver extrato
          </Link>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Numero valor={ficha.creditos.disponiveis} rotulo="Disponíveis" destaque />
          <Numero valor={ficha.creditos.agendados} rotulo="Agendados" />
          <Numero valor={ficha.creditos.total} rotulo="Total" />
        </div>
        {ficha.creditos.proximaValidade ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <Pill tone={ficha.creditos.tomDaValidade}>
              {/* A6/lote 3: contrato pausado congela a validade — nem "venceu"
                  nem "vale até" (ver `validadeCongelada`). */}
              {ficha.creditos.validadeCongelada
                ? 'valia até'
                : ficha.creditos.tomDaValidade === 'danger'
                  ? 'venceu'
                  : 'vale até'}{' '}
              {ficha.creditos.proximaValidade}
              {ficha.creditos.validadeCongelada && ' — contagem parada'}
            </Pill>
            o mais antigo da fila
          </p>
        ) : (
          <p className="text-sm text-ink-600">Nenhum crédito acumulado.</p>
        )}
      </Cartao>
    </div>
  )
}
