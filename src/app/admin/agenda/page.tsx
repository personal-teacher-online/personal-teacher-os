// AGENDA — N1 da seção (Onda da Agenda · A1: a FUNDAÇÃO).
//
// ANATOMIA (clonagem TutorBird, `mapeamento-tutorbird-2.md`):
//
//   card-contêiner  ← abas Agenda | Pendências (n) | Período
//     toolbar       ← [Nova aula ▾] + navegação no tempo à esquerda
//                     visões · professora · horários abertos à direita
//     conteúdo      ← grade (dia/semana/mês), lista ou fila de pendências
//
// O TÍTULO não mora aqui: vive na barra branca do shell, derivado do trilho.
//
// O QUE MORREU NESTE A1:
// · a página-monólito de 847 linhas com query inline (agora `src/data/admin/agenda.ts`);
// · CINCO consultas que descartavam o `error` do PostgREST — numa agenda isso
//   desenhava "nenhuma aula" para um erro de rede, ou seja, mentia sobre o dia
//   da escola. A camada de dados estoura e acende o `error.tsx`;
// · a fileira única de chips onde criar aula, publicar horário, trocar de visão
//   e filtrar professora tinham o mesmo peso — e os dois links de criar aula
//   soltos abaixo dela, sem moldura;
// · `?painel=` e `?pub=` como duas chaves para a mesma ideia (viraram `?novo=`).
//
// O QUE JÁ SAIU DO LEGADO (A2): a grade é o `kit/calendario.tsx` (fork do
// `CalendarGrid`, que segue servindo só /teacher) — pele da régua medida e
// popups de evento/slot no Popover do kit, `<details data-popup>` morto na
// grade.
//
// O QUE SAIU DO LEGADO NO A4: o balão da meia-hora vazia. Ele oferecia UMA
// coisa ("Publicar horário") e só com o botão "com janelas" ligado; agora são as
// TRÊS INTENÇÕES do vazio, cada uma com a consequência escrita, e o botão de
// janelas voltou a governar só o que APARECE (`IntencoesDoSlot`). O erro de
// qualquer uma delas REABRE o mesmo balão com o que foi digitado (`?slot=`/`?si=`).
//
// O QUE SAIU DO LEGADO NO A5: o balão do EVENTO e o desfecho.
// · o `pieces.tsx` MORREU inteiro — o trio de botões ("aconteceu" / "aluno
//   faltou" / "professora faltou") e o `<details data-popup>` "Cancelar aula…"
//   viraram UMA matriz do ADR-018 (`DesfechoDaAula`), com cinco linhas, a
//   consequência CONFERIDA no corpo de cada RPC e um CTA grande. Ela serve as
//   DUAS superfícies de registro: o balão e a fila de pendências;
// · o popup do evento é o `BalaoDaAula`: barra de ícones (remarcar · duplicar ·
//   fechar — "excluir" não existe porque delete de aula não existe no banco),
//   dados, e as abas Desfecho | Histórico (a trilha do `audit_log`, sem inventar
//   nome de ator);
// · o desfecho volta no COOKIE da seção (`@/lib/kit/recado`), não em `?msg=`, e
//   o erro reabre o balão daquela aula por `?ev=` com o que foi digitado.
//
// O QUE SAIU DO LEGADO NO A7: o TRANSPORTE, e a fila de pendências.
// · nenhuma action desta seção volta mais por `?msg=`. As que restavam passaram
//   ao transporte único (`@/lib/admin/transporte-da-agenda`): lista de campos do
//   SERVIDOR, chave de rascunho DERIVADA do destino, destino RECONSTRUÍDO por
//   allowlist. Os formulários pararam de declarar `manter`, `na_url` e
//   `rascunho` — três decisões do servidor que viajavam como dado do cliente;
// · o recado passou a ser do ENDEREÇO, e não da seção: ele aparece uma vez, no
//   destino do ato, e não repinta quando a dona troca de aba;
// · a fila de pendências virou lista única, com a MAIS ANTIGA gritando primeiro;
// · o lote "todas aconteceram" trocou o `<details data-popup>` do `ConfirmAction`
//   pelo AlertDialog do kit — o mesmo primitivo do `ConfirmarDesfecho` —, com o
//   gesto por professora (S2-7) e as travas do portão de 29/07 INTACTOS.
//
// O QUE AINDA É LEGADO AQUI, de propósito:
// · `cancelClassAction` continua na ponte `?msg=` porque quem a usa é a FICHA DO
//   ALUNO, e o cookie desta seção tem `path` estreito — gravá-lo lá seria
//   cancelar a aula sem recado nenhum. Ela migra na onda da ficha. É por isso
//   que a leitura de `?msg=` continua existindo lá embaixo.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { BarraDaAgenda } from '@/components/admin/agenda/BarraDaAgenda'
// `ehIntencaoDoSlot` vem do módulo PURO, nunca do componente: importar função
// através de um arquivo 'use client' e chamá-la no servidor estoura em RUNTIME
// (RSC), invisível para jsdom e para o build — foi o 1º achado da 1ª execução
// real do e2e (30/07).
import { ehIntencaoDoSlot } from '@/lib/admin/intencoes-do-slot'
import {
  IntencoesDoSlot,
  ProvedorDoSlot,
  type DadosDoSlot,
} from '@/components/admin/agenda/IntencoesDoSlot'
import {
  CamposDaAvulsa,
  CamposDaExperimental,
  type ProfessoraDoSlot,
} from '@/components/admin/agenda/campos-de-aula'
import {
  chaveDoBalao,
  chaveDoDesfecho,
  chaveDoPainel,
  lerRascunho,
} from '@/lib/admin/rascunho-do-formulario'
import {
  chaveDoDestino,
  enderecoDaTela,
  geometriaCanonica,
  type TelaDaAgenda,
} from '@/lib/admin/transporte-da-agenda'
import { lerRecado } from '@/lib/kit/recado'
import { BalaoDaAula } from '@/components/admin/agenda/BalaoDaAula'
import { ConfirmarLote } from '@/components/admin/agenda/ConfirmarLote'
import { DesfechoDaAula } from '@/components/admin/agenda/DesfechoDaAula'
import { tzLabel } from '@/lib/format'
import { BLOCKED_BG, Calendario, type CalEvent } from '@/components/kit/calendario'
import { DateField } from '@/components/DateField'
import { TimeField } from '@/components/TimeField'
import { subtractBusy } from '@/lib/google/busy-subtract'
import { googleBusyForTeacher } from '@/lib/google/sync'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUSINESS_TZ } from '@/lib/brand/constants'
import {
  getAgenda,
  historicoDaAula,
  type AulaDaAgenda,
  type EventoDoHistorico,
} from '@/data/admin/agenda'
import {
  comMudanca,
  estadoDaQuery,
  primeiroValor,
  type ValorDaQuery,
} from '@/data/admin/agenda-endereco'
import {
  Actions,
  btnInk,
  Field,
  input,
  linkDanger,
  Pill,
  TEACHER_EDGE,
  TEACHER_TEXT,
  TEACHER_TINT,
} from '@/components/ui'
import {
  addTeacherBlockAction,
  addWeeklyAvailabilityAction,
  cancelWindowAction,
  completeAllPendingAction,
  createSingleClassAction,
  createTrialClassAction,
  publishWindowAction,
  removeTeacherBlockAction,
  removeWeeklyAvailabilityAction,
} from './actions'

export const metadata = { title: 'Agenda — Admin' }

/** Botão compacto da SUPERFÍCIE A3, no piso de AÇÃO da régua (texto ≥ text-sm).
 *  O `btnInkSm` do kit força `!text-xs` — abaixo do piso; reformá-lo vale para
 *  o site inteiro e é dívida de kit anotada para onda própria (Sol · rodada 1
 *  do A3, item 10). Aqui só a variante local, com a mesma anatomia. */
const btnInkA3 = 'btn-ink !min-h-9 !px-3.5 !py-1.5 !text-sm'

/** O irmão de PAPEL do `btnInkA3`: mesma anatomia, mesmo piso de texto. Nasceu
 *  no A5 para o menu da linha da visão-lista, onde a ação secundária estava em
 *  `btnPaperSm` (`!text-xs`, abaixo do piso de AÇÃO da régua). O par de botões
 *  daquele menu passou aos dois, para não ficar um em cada tamanho. */
const btnPaperA5 = 'btn-paper !min-h-9 !px-3.5 !py-1.5 !text-sm'

/** "seg, 04/08" a partir da data civil do slot. Server Component: formatar aqui
 *  é permitido (a proibição do lint vale para arquivo `'use client'`). */
function formatarDiaCurto(iso: string): string {
  return DateTime.fromISO(iso, { zone: BUSINESS_TZ }).setLocale('pt-BR').toFormat('ccc, dd/LL')
}

/**
 * O INSTANTE do slot, em UTC — a mesma conta do banco
 * (`(date + time) at time zone tz`), feita aqui com Luxon e no SERVIDOR (Lei 1).
 *
 * É dele que o balão tira o equivalente local de qualquer outro fuso quando a
 * dona escolhe o contrato ou a cidade (Sol · rodada 1 do A4, grave 3): a
 * conversão inversa — civil → instante — é a que exige biblioteca de data, e é
 * exatamente a que o cliente não pode fazer.
 */
function instanteDoSlot(iso: string, hhmm: string): string {
  return DateTime.fromISO(`${iso}T${hhmm}`, { zone: BUSINESS_TZ }).toUTC().toISO()!
}

/** Traduz a situação do domínio para os sinais ORTOGONAIS da grade (M-AG):
 *  a cor é sempre da professora; o estado é acento, nunca repintura de fundo. */
/**
 * A partir de QUANTOS dias a dívida de registro passa de âmbar para vermelho.
 *
 * Uma semana: é o ciclo do horário fixo do contrato, ou seja o ponto em que a
 * aula sem desfecho deixou de ser "a da semana passada" e virou uma linha que
 * a professora já viu no extrato dela sem contrapartida no sistema. Número
 * escolhido pela régua do produto, não medido no banco — e por isso escrito
 * aqui, com nome, em vez de espalhado num ternário.
 */
const ATRASO_GRAVE_DIAS = 7

const ehAtrasoGrave = (dias: number | undefined): boolean =>
  dias !== undefined && dias >= ATRASO_GRAVE_DIAS

function sinaisDe(a: AulaDaAgenda) {
  return {
    dim: a.situacao === 'realizada',
    strike: a.situacao === 'cancelada' || a.situacao === 'remarcada',
    falta: a.situacao === 'falta_aluno' || a.situacao === 'falta_professora',
    warn: a.situacao === 'sem_registro',
  }
}

export default async function AgendaPage({
  searchParams,
}: {
  // SOL · achado 14: `searchParams` entrega ARRAY para parâmetro repetido
  // (`?q=a&q=b`). O tipo mentia dizendo `string`, e o código quebrava. Todo
  // acesso passa por `primeiroValor`.
  searchParams: Promise<{
    v?: ValorDaQuery
    d?: ValorDaQuery
    prof?: ValorDaQuery
    j?: ValorDaQuery
    q?: ValorDaQuery
    novo?: ValorDaQuery
    nd?: ValorDaQuery
    nt?: ValorDaQuery
    // ponte do feedback legado: nenhuma action desta seção a escreve (A7); ela
    // sobrevive para link salvo, aba velha e o caminho degenerado do
    // `cancelClassAction` — ver o bloco "O RECADO"

    msg?: ValorDaQuery
    n?: ValorDaQuery
    // A4 — volta de erro do balão do slot: QUAL meia-hora reabre ('yyyy-LL-ddTHH:mm')
    // e em QUAL intenção (avulsa|experimental|horario|bloqueio)
    slot?: ValorDaQuery
    si?: ValorDaQuery
    // A5 — a aula EM FOCO (balão reaberto na volta de erro + dono do rascunho)
    ev?: ValorDaQuery
    // A5 — o contrato que o "duplicar" já traz escolhido no painel da avulsa
    nc?: ValorDaQuery
    // chaves da tela velha — link salvo não pode quebrar
    painel?: ValorDaQuery
    pub?: ValorDaQuery
    // …e o resto: NADA do que a dona digita chega aqui desde o A4 (os campos
    // viajam no cookie de rascunho), mas o índice fica porque `searchParams`
    // é aberto e `primeiroValor` precisa poder olhar qualquer chave.
    [campo: string]: ValorDaQuery
  }>
}) {
  const sp = await searchParams

  const estado = estadoDaQuery(sp)

  // COMPATIBILIDADE DE LINK SALVO: `?painel=` e `?pub=1` eram duas chaves para a
  // mesma ideia (abrir um formulário de criação). Viraram `?novo=`.
  //
  // SOL · achado 1: a primeira versão redirecionava para uma URL CONSTANTE e
  // jogava fora visão, data, professora, camada e o prefill — o link salvo
  // `?v=dia&d=…&prof=…&pub=1&nd=…&nt=…` abria a semana atual, sem nada
  // preenchido. Compatibilidade que perde o contexto não é compatibilidade.
  const painelLegado = primeiroValor(sp.painel)
  const nd = primeiroValor(sp.nd)
  const nt = primeiroValor(sp.nt)
  // O par `nd`+`nt` SOZINHO também abria o formulário de publicação na tela
  // velha (sem `pub=1`) — sem este ramo, esse link salvo deixaria de abrir
  // qualquer coisa e a dona veria só a grade, sem entender por quê.
  const qualLegado =
    painelLegado === 'avulsa' || painelLegado === 'experimental'
      ? painelLegado
      : primeiroValor(sp.pub) === '1' || (!primeiroValor(sp.novo) && nd && nt)
        ? 'horario'
        : null
  if (qualLegado) {
    // Reconstrói a URL a partir do que CHEGOU, tirando só as chaves mortas.
    // Não passa pelo `enderecoDaAgenda` de propósito: aqui ainda não se sabe
    // que dia é hoje no fuso do negócio (quem sabe é a camada de dados), e a
    // regra do endereço curto depende disso.
    const p = new URLSearchParams()
    for (const [chave, valor] of [
      ['v', primeiroValor(sp.v)],
      ['d', primeiroValor(sp.d)],
      ['prof', primeiroValor(sp.prof)],
      ['j', primeiroValor(sp.j)],
      ['q', primeiroValor(sp.q)],
      ['nd', nd],
      ['nt', nt],
    ] as const) {
      if (valor) p.set(chave, valor)
    }
    p.set('novo', qualLegado)
    redirect(`/admin/agenda?${p.toString()}`)
  }
  const agenda = await getAgenda({
    visao: estado.visao,
    ancora: estado.ancora,
    professora: estado.professora,
    comJanelas: estado.comJanelas,
    busca: estado.busca,
  })

  const self = comMudanca(estado, {}, agenda.hojeISO)

  /* ------------------------------------------- A7: o endereço DESTA tela ----
   * A MESMA função que a action usa para montar o destino, aplicada à query
   * que chegou. Duas coisas saem daqui, e as duas dependem de as duas pontas
   * falarem a mesma língua:
   *
   *   1. `enderecoAqui` — para o recado saber se ele é DESTE endereço. Sem
   *      isso, o "✓ Aula registrada" repintava a cada navegação da seção
   *      dentro dos 15 s de vida do cookie: a dona registrava o desfecho e,
   *      ao tocar na aba Pendências para conferir a fila, via o mesmo ✓ de
   *      novo — que num ato de dinheiro lê como um SEGUNDO registro;
   *   2. `chaveAqui` — de quem é o rascunho que este endereço reabre. A action
   *      grava sob a chave DERIVADA do destino, e a página lê a derivada do
   *      endereço em que está: escritor e leitor não têm como divergir (foi
   *      divergindo que o painel voltava vazio no A4, e o conserto de lá teve
   *      de ser lembrar de pendurar `nd`/`nt` no `back_erro`).
   */
  const CASA: TelaDaAgenda = { tela: 'casa' }
  const daQuery = geometriaCanonica(CASA, true, (k) => primeiroValor(sp[k]))
  const enderecoAqui = enderecoDaTela(CASA, daQuery)
  const chaveAqui = chaveDoDestino(CASA, daQuery)
  /** UMA leitura do cookie: ele tem uma gaveta só, e ela é a deste endereço. */
  const rascunhoAqui = chaveAqui ? await lerRascunho(chaveAqui) : {}
  /** O rascunho DAQUELE formulário — vazio quando não é o que o endereço abre. */
  const doRascunho = (chave: string): Record<string, string> =>
    chave && chave === chaveAqui ? rascunhoAqui : {}

  const novoHref = (qual: string) => `${self}${self.includes('?') ? '&' : '?'}novo=${qual}`
  const diaHref = (iso: string) => comMudanca(estado, { visao: 'dia', ancora: iso }, agenda.hojeISO)

  /* ---------------------------------------------- A5: a aula EM FOCO (`?ev=`)
   * `?ev=<id>` diz QUAL aula está com o balão aberto, e é só isso que ela diz:
   * id de aula, nada mais. Nome, nota de cortesia, hora do aviso e a frase do
   * recado ficam FORA da URL (é a mesma régua do grave 5 do A4 — LGPD).
   *
   * Ela serve duas coisas, e a segunda vale também onde não há balão:
   *   1. na grade, a volta de erro reabre o balão daquela aula (plumbing igual
   *      ao `?slot=` do A4, com a lição do mount cliente — sem ela a semana
   *      monta DOIS balões abertos, um deles órfão no portal);
   *   2. em qualquer visão, ela diz de QUEM é o rascunho a restaurar — o cookie
   *      tem uma gaveta só, e rascunho de uma aula não pode preencher o
   *      formulário de outra (grave 4 do A4).
   *
   * FORMA conferida aqui: o valor vira comparação de string dentro da grade e
   * chave de rascunho, então um `?ev=` forjado não pode abrir balão nenhum nem
   * virar texto na tela. Conjunto seguro (o mesmo critério do
   * `aplicarOpcoesDaRemarcacaoAction`), não formato de uuid. */
  const evCru = primeiroValor(sp.ev)
  const emFoco = evCru && /^[A-Za-z0-9._-]{1,64}$/.test(evCru) ? evCru : null
  /** A tela com o balão DESTA aula reaberto — o `back_erro` dos formulários. */
  const focoHref = (id: string) =>
    `${self}${self.includes('?') ? '&' : '?'}ev=${encodeURIComponent(id)}`
  /** O DIA daquela aula com o balão dela aberto (a ponte da visão-lista). O
   *  `includes('?')` não é decoração: `enderecoDaAgenda` devolve `/admin/agenda`
   *  SEM query quando o estado é o padrão, e concatenar `&ev=` num endereço sem
   *  `?` produz um link que não abre nada. */
  const diaComFoco = (iso: string, id: string) => {
    const alvo = diaHref(iso)
    return `${alvo}${alvo.includes('?') ? '&' : '?'}ev=${encodeURIComponent(id)}`
  }
  /**
   * AGORA no fuso do negócio, para o `max` do campo "quando o aviso chegou".
   *
   * Server Component monta a data (Lei 1: o cliente não formata nem calcula
   * data), no formato que `<input type="datetime-local">` entende. É a mesma
   * guarda que a ficha do aluno já dava no MESMO campo — o banco recusa aviso no
   * futuro (`if p_notified_at > now() then raise`), e sem `max` a Agenda só
   * descobria isso depois da ida ao servidor.
   */
  const agoraNoNegocio = DateTime.now().setZone(BUSINESS_TZ).toFormat("yyyy-LL-dd'T'HH:mm")

  /** O que ela digitou e voltou depois de um erro, e SÓ na aula em foco. */
  const digitadoDaAula = (id: string): Record<string, string> =>
    id === emFoco ? doRascunho(chaveDoDesfecho(id)) : {}

  /* ------------------------------------------------------ A5: o "duplicar" ---
   * Abre o painel da aula AVULSA no mesmo horário desta aula, já no contrato
   * dela. `nd`/`nt` são a data e a hora EM CUIABÁ (o ponto da grade), e é delas
   * que o painel tira o instante para reescrever os campos no fuso do aluno —
   * então duplicar cai no MESMO instante real, não em algarismos iguais noutro
   * relógio (grave 3 do A4).
   *
   * `nc` (o contrato) entra na URL só quando ele é LEGÍVEL: `contractId` é
   * `null` quando o embed do contrato não veio, e nesse caso o painel abre no
   * mesmo horário com o aluno a escolher — em vez de um ícone que promete o que
   * a tela não sabe fazer. É id opaco, como o `?ev=`: nada de pessoa na URL. */
  const duplicarHref = (a: AulaDaAgenda) => {
    const dia = DateTime.fromISO(a.inicioUtc).setZone(BUSINESS_TZ).toFormat('yyyy-LL-dd')
    const base = `${novoHref('avulsa')}&nd=${dia}&nt=${encodeURIComponent(a.hora)}`
    return a.contractId ? `${base}&nc=${encodeURIComponent(a.contractId)}` : base
  }

  const abas = [
    {
      label: 'Agenda',
      href: comMudanca(estado, { visao: 'semana', ancora: undefined }, agenda.hojeISO),
      active: agenda.visao !== 'pendencias',
    },
    {
      label: 'Pendências',
      href: comMudanca(estado, { visao: 'pendencias' }, agenda.hojeISO),
      active: agenda.visao === 'pendencias',
      count: agenda.pendencias.length,
    },
    { label: 'Período', href: '/admin/agenda/periodo' },
  ]

  /* ---------------------------------------------------- eventos da grade --- */
  const naGrade = agenda.visao === 'dia' || agenda.visao === 'semana' || agenda.visao === 'mes'
  /* A TRILHA das aulas visíveis, em UMA consulta por bloco de 40 (nunca uma por
   * aula — a régua escrita no `historicoDaAula`). Só nas visões com balão: a
   * fila de pendências e a lista não têm popover, e pagar a consulta ali seria
   * latência por nada. Falha de leitura ESTOURA na camada de dados (acende o
   * `error.tsx`): agenda que mente sobre o histórico de dinheiro é pior que
   * agenda que não abre. */
  const historico: Record<string, EventoDoHistorico[]> = naGrade
    ? await historicoDaAula(agenda.aulas.map((a) => a.id))
    : {}
  const eventos: CalEvent[] = agenda.aulas.map((a) => ({
    id: a.id,
    startsAtUtc: a.inicioUtc,
    endsAtUtc: a.fimUtc,
    title: a.quem,
    color: a.teacherIdx,
    ...sinaisDe(a),
    hoverExtra: a.horaDoAluno ? `para o aluno: ${a.horaDoAluno}` : undefined,
    popup: (
      <BalaoDaAula
        a={a}
        back={self}
        backErro={focoHref(a.id)}
        duplicarHref={duplicarHref(a)}
        historico={historico[a.id] ?? []}
        digitado={digitadoDaAula(a.id)}
        agoraNoNegocio={agoraNoNegocio}
      />
    ),
  }))

  const eventosDeJanela: CalEvent[] = agenda.janelas.map((w) => ({
    id: `w-${w.id}`,
    startsAtUtc: w.inicioUtc,
    title: w.estado === 'consumida' ? 'horário usado' : 'horário aberto',
    color: w.teacherIdx,
    dashed: true,
    dim: w.estado !== 'publicada',
    popup: (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-ink-900">Horário de remarcação</span>
          <Pill tone={w.estado === 'publicada' ? 'ok' : 'muted'}>
            {w.estado === 'publicada' ? 'aberto' : 'usado'}
          </Pill>
        </div>
        {/* Professora e horário do slot ofertado: DADO (é o que ela despublica). */}
        <p className="text-sm font-medium text-ink-900">
          {w.teacherNome ?? '—'} · {w.instante.texto}
        </p>
        {w.estado === 'publicada' && (
          <form action={cancelWindowAction} className="border-t border-line-soft pt-2">
            <input type="hidden" name="window_id" value={w.id} />
            <input type="hidden" name="back" value={self} />
            <button type="submit" className={linkDanger}>
              Despublicar este horário
            </button>
          </form>
        )}
      </div>
    ),
  }))

  // Compromissos pessoais do Google da professora filtrada: contexto, não
  // protagonista. Fail-open — indisponível vira aviso, nunca bloqueio.
  let googleIndisponivel = false
  if (naGrade && estado.professora) {
    const busy = await googleBusyForTeacher(createAdminClient(), estado.professora, {
      fromUtcISO: agenda.intervalo.inicioUtc,
      toUtcISO: agenda.intervalo.fimUtc,
    })
    if (busy.status === 'ok') {
      // Subtrai das faixas ocupadas o que JÁ é aula do sistema — evento manual
      // antigo (ou eco do nosso próprio sync) não vira bloco concorrente.
      const daEscola = eventos
        .filter((e) => !e.strike && e.endsAtUtc)
        .map((e) => ({ startUtc: e.startsAtUtc, endUtc: e.endsAtUtc! }))
      eventos.push(
        ...subtractBusy(busy.blocks, daEscola).map((b, i) => ({
          id: `g-${i}`,
          startsAtUtc: b.startUtc,
          endsAtUtc: b.endUtc,
          title: 'ocupada (agenda pessoal)',
          color: agenda.professoras.find((t) => t.id === estado.professora)?.idx ?? 0,
          ghost: true,
        })),
      )
    } else if (busy.status === 'indisponivel') {
      googleIndisponivel = true
    }
  }

  // A3 — camada de disponibilidade/bloqueios: a MESMA chave da camada do
  // Google (professora filtrada), só nas visões com grade de HORAS (o mês não
  // recebe camada de fundo — decisão da rodada 2 do Sol no A2). Fica num array
  // PRÓPRIO, fora de `eventos`: o `daEscola` da subtração do Google lê
  // `eventos` e uma janela de disponibilidade não é aula da escola.
  const camadaAtiva = naGrade && Boolean(estado.professora) && agenda.visao !== 'mes'
  // o índice de COR da professora filtrada serve a camada E o swatch da legenda
  // (Sol · rodada 1 do A3, item 9: legenda em --t0 fixo mentia a cor da camada)
  const idxDaFiltrada = agenda.professoras.find((t) => t.id === estado.professora)?.idx ?? 0
  const camadaDeDisponibilidade: CalEvent[] = []
  if (camadaAtiva && agenda.disponibilidade) {
    camadaDeDisponibilidade.push(
      ...agenda.disponibilidade.eventosAvail.map((e) => ({
        id: `av-${e.id}`,
        startsAtUtc: e.inicioUtc,
        endsAtUtc: e.fimUtc,
        title: 'disponível',
        color: idxDaFiltrada,
        avail: true,
      })),
      ...agenda.disponibilidade.eventosBloqueio.map((e) => ({
        id: `bl-${e.id}`,
        startsAtUtc: e.inicioUtc,
        endsAtUtc: e.fimUtc,
        title: e.titulo,
        color: idxDaFiltrada,
        blocked: true,
      })),
    )
  }

  const prefillDate = nd && /^\d{4}-\d{2}-\d{2}$/.test(nd) ? nd : undefined
  const prefillTime = nt && /^\d{2}:\d{2}$/.test(nt) ? nt : undefined
  const novo = primeiroValor(sp.novo)

  /* ------------------------------------------------ o lote das pendências ---
   * PORTÃO DE DEPLOY 29/07 (bloqueador 1): o botão prometia N e o banco fazia
   * menos, dizendo que deu certo. O pulo é CERTO — `complete_class` recusa aula
   * sem apontamento de conteúdo, e a RPC do lote a manda para `skipped` —, o
   * errado era a TELA: ela contava e enviava a fila inteira e depois exibia um ✓
   * verde por um número menor. Agora a separação acontece ANTES de confirmar: o
   * botão conta e envia só o que pode concluir, e o aviso diz quantas ficam de
   * fora e por quê.
   *
   * ⚠️ E O MOTIVO NÃO É O EXTRATO (A5/L5). Este comentário e as duas frases da
   * aba diziam "aula sem apontamento não conta no extrato", e isso é falso:
   * `_teacher_payable_hours` não consulta `class_content_reports` em lugar
   * nenhum, e a hora de uma aula passada `scheduled` (contrato não pausado) já
   * está na soma. O apontamento trava o REGISTRO, não o pagamento — a tela se
   * contradizia a poucos centímetros do `AVISO_DA_HORA` da própria matriz. */
  const doLote = agenda.pendencias.filter((r) => r.temApontamento)
  const foraDoLote = agenda.pendencias.length - doLote.length
  const nomeDaFiltrada =
    agenda.professoras.find((t) => t.id === estado.professora)?.nome ?? 'professora'
  const frasePendentes = (n: number) => `${n} aula${n > 1 ? 's' : ''}`

  /* ------------------------------------------------- volta de ERRO dos painéis
   * (bloqueador 6): sucesso fecha o painel (`self`), erro devolve para ele
   * ABERTO — e a action guarda os campos de `CAMPOS_DA_PORTA` (lista do
   * SERVIDOR, A7), que a página relê abaixo. Sem isso, um erro do banco fechava
   * o painel e apagava tudo o que a dona tinha digitado.
   *
   * ONDE ELES VIAJAM (Sol · rodada 1 do A4, grave 5 — LGPD): num COOKIE
   * `httpOnly` de vida curta, não mais na query string. Nome do aluno, fuso,
   * preço e o motivo do bloqueio ("consulta médica") não podem ficar no
   * histórico do navegador, no log de acesso nem numa captura de tela. Na URL
   * fica só a geometria: `?novo=`, `?slot=`, `?si=`.
   *
   * O ALVO ENTRA NA CHAVE DO RASCUNHO (revisão independente do A4, médio 1):
   * `painel:avulsa` era chave de FORMULÁRIO, e o cookie sobrevive 60s ao painel
   * fechado — um link salvo para outro dia/hora nascia com o nome, a professora
   * e o horário da tentativa anterior por cima do `nd`/`nt` novo. Ver
   * `chaveDoPainel`. Por isso o `back_erro` também leva `nd`/`nt`: sem eles, a
   * volta de erro cairia numa chave DIFERENTE da que a action acabou de gravar
   * e o painel voltaria vazio. */
  const alvoDoPainel = prefillDate && prefillTime ? `${prefillDate}T${prefillTime}` : ''
  const painelDeErro = (qual: string) =>
    alvoDoPainel
      ? `${novoHref(qual)}&nd=${encodeURIComponent(prefillDate!)}&nt=${encodeURIComponent(prefillTime!)}`
      : novoHref(qual)
  const chaveDoPainelAberto = (qual: string) => chaveDoPainel(qual, alvoDoPainel)
  const rascunhoDoPainel = novo ? doRascunho(chaveDoPainelAberto(novo)) : {}
  /** O que a dona digitou e voltou depois de um erro DESTE painel (chave = name). */
  const digitado = (campo: string): string | undefined => rascunhoDoPainel[campo]

  /* O contrato que o "duplicar" trouxe (`?nc=`). Ele SEMEIA o painel da avulsa;
   * o rascunho de um erro anterior VENCE, porque é o que a dona corrigiu por
   * último. Forma conferida: o valor só é comparado com os `value` das opções, e
   * um `nc` forjado não casa com nenhuma — o seletor abre em "Escolha…". */
  const ncCru = primeiroValor(sp.nc)
  const contratoDoDuplicar = ncCru && /^[A-Za-z0-9._-]{1,64}$/.test(ncCru) ? ncCru : undefined
  const digitadoDaAvulsa: Record<string, string> = contratoDoDuplicar
    ? { contract_id: contratoDoDuplicar, ...rascunhoDoPainel }
    : rascunhoDoPainel

  /**
   * O INSTANTE do ponto tocado, quando o painel foi aberto a partir da grade
   * (`?nd=`/`?nt=`, que são data e hora EM CUIABÁ). É dele que as peças
   * compartilhadas tiram o equivalente no fuso do aluno quando ela escolhe o
   * contrato ou a cidade (Sol · rodada 2 do A4, grave 3). Sem `nd`/`nt` não há
   * ponto tocado: `null`, e nada é recalculado — mentir horário é pior que não
   * converter.
   */
  const instanteDoPrefill =
    prefillDate && prefillTime ? instanteDoSlot(prefillDate, prefillTime) : null

  /** As professoras no formato das peças compartilhadas (o mesmo do balão). */
  const professorasDoSlot: ProfessoraDoSlot[] = agenda.professoras.map((t) => ({
    id: t.id,
    nome: t.nome,
    ianaTz: t.tz,
    cidade: tzLabel(t.tz),
  }))

  /* ------------------------------------------------ A4: o balão do slot vazio
   * Só `slot` e `si` viajam na URL — a primeira diz QUAL meia-hora reabre, a
   * segunda em QUAL das quatro intenções. O que foi digitado vem do cookie, sob
   * a chave daquele slot NAQUELA intenção: rascunho das 14:00 não preenche o
   * balão das 14:30 (grave 4) nem o painel `?novo=` (grave 5). */
  const slotCru = primeiroValor(sp.slot)
  // FORMA conferida aqui (a chave vira comparação de string dentro da grade):
  // um `?slot=` forjado não pode abrir balão nenhum nem virar texto na tela.
  const slotDoErro = slotCru && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slotCru) ? slotCru : null
  const siCru = primeiroValor(sp.si)
  const intencaoDoErro = ehIntencaoDoSlot(siCru) ? siCru : null
  // Reabrir sem saber QUAL intenção falhou deixaria a dona na lista de três com
  // os campos preenchidos escondidos atrás de um clique — os dois andam juntos
  // ou nenhum anda. UMA conta só, usada pela grade E pelo balão.
  const balaoAberto = slotDoErro && intencaoDoErro ? slotDoErro : null
  const dadosDoSlot: DadosDoSlot = {
    self,
    // A professora leva o FUSO DELA (F3-D2) em IANA e em cidade: é nele que
    // `add_teacher_block` conta o dia civil do bloqueio (médio 1 do Sol).
    professoras: professorasDoSlot,
    professoraFiltrada: estado.professora ?? null,
    contratos: agenda.contratos,
    digitado: balaoAberto ? doRascunho(chaveDoBalao(balaoAberto, intencaoDoErro!)) : {},
    slotDoErro: balaoAberto,
    intencaoDoErro: balaoAberto ? intencaoDoErro : null,
  }

  /* ----------------------------------------------------- O RECADO (A5 · A7) ---
   * NENHUMA action desta seção escreve mais `?msg=` (A7). A ponte que sobrava
   * — `cancelClassAction`, reusada pelo painel "cancelar" da FICHA DO ALUNO —
   * volta para `/admin/alunos/…`, não para cá; ela migra na onda da ficha, e o
   * cookie desta seção não a alcança porque tem `path` estreito.
   *
   * A LEITURA DE `?msg=` FICA, e é rede, não convivência: link salvo, aba velha
   * e o caminho degenerado daquela action (um `back` que não começa com
   * `/admin`) ainda podem trazer a dona para cá com a frase na URL. Perder o
   * recado nesses casos seria pior do que lê-lo.
   *
   * ⚠️ A PRECEDÊNCIA INVERTEU, e a razão inverteu junto. Enquanto as onze
   * actions legadas viviam aqui, `?msg=` era o recado FRESCO e o cookie era a
   * sobra — hoje é o contrário: o cookie só existe se uma action desta seção
   * acabou de rodar (15 s), e `?msg=` só chega por endereço guardado, de idade
   * desconhecida. O cookie vem primeiro.
   *
   * UM AVISO SÓ, SEMPRE — e agora ele também é do ENDEREÇO (`enderecoAqui`):
   * o recado gravado para o destino do desfecho não repinta quando a dona toca
   * na aba Pendências dois segundos depois. Ver o cabeçalho do `recado.ts`.
   *
   * Quem lê é a PÁGINA, nunca o layout do admin: layout compartilhado não
   * re-renderiza em soft nav (família do ADR-030) e o recado ficaria pendurado. */
  const doCookie = await lerRecado('agenda', enderecoAqui)
  const daPonte = doCookie ? '' : (primeiroValor(sp.msg) ?? '')

  return (
    <main className="view-enter flex flex-col gap-6">
      {doCookie ? (
        <AvisoLegado mensagem={doCookie.mensagem} chave={doCookie.id} />
      ) : (
        <AvisoLegado mensagem={daPonte} chave={primeiroValor(sp.n)} />
      )}

      <CardPanel>
        <CardPanelTabs tabs={abas} />
        <BarraDaAgenda agenda={agenda} estado={estado} novoHref={novoHref} />

        {agenda.visao === 'pendencias' ? (
          <section className="flex flex-col gap-4 p-5">
            <p className="max-w-2xl text-sm text-ink-600">
              {agenda.pendencias.length === 0
                ? 'Nenhuma aula passada está sem registro.'
                : /* A5/L5 — A FRASE ANTIGA ERA FALSA: "o sistema aplica a regra do
                     contrato (crédito ou perda) sozinho". Nada no CONTRATO decide
                     crédito × perda — `_cancel_class_core` decide por
                     `p_cancelled_by` (ADR-018), e as colunas de expiry do contrato
                     só definem a VALIDADE do crédito que já foi decidido. Quem diz
                     a consequência agora é a própria matriz, linha por linha. */
                  `${agenda.pendencias.length} aula${agenda.pendencias.length > 1 ? 's' : ''} sem registro. Marque o que aconteceu — cada opção diz, antes de você confirmar, o que ela faz com a hora da professora e com o crédito do aluno.`}
            </p>
            {agenda.pendencias.length === 0 ? (
              <EmptyState
                illustration="/illustrations/agenda-vazia.svg"
                title="Tudo registrado."
                hint="Nenhuma aula passada está sem desfecho — é assim que o extrato das professoras fecha sem discussão."
                cta="Voltar para a semana"
                href={comMudanca(estado, { visao: 'semana' }, agenda.hojeISO)}
              />
            ) : (
              <>
                {/* F2/M1-3 + S2-7: o lote existe SÓ para o desfecho positivo, e
                    exige filtro de professora + confirmação em dois passos —
                    atestar em massa é ação de dinheiro (entra no extrato dela),
                    então é gesto consciente por professora. Falta e
                    cancelamento seguem unitários.

                    A7: a MOLDURA virou o AlertDialog do kit (o `ConfirmAction`
                    era um `<details data-popup>`, proibido em tela nova pelo
                    AGENTS.md e já morto no balão do evento). A REGRA não mudou
                    em nada — contagem do elegível, IDs explícitos
                    all-or-nothing, aviso de quantas ficam de fora, gesto por
                    professora e desfecho com o número real. */}
                {estado.professora ? (
                  doLote.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <ConfirmarLote
                        rotulo={`✓ Todas aconteceram (${doLote.length})`}
                        aviso={
                          `Confirmar ${frasePendentes(doLote.length)} da ${nomeDaFiltrada} como realizada${doLote.length > 1 ? 's' : ''}? Cada uma é auditada e conta no extrato; faltas registre uma a uma.` +
                          (foraDoLote > 0
                            ? // A5/L5 — a razão do pulo estava ERRADA aqui: não é o
                              // extrato. `_teacher_payable_hours` não consulta
                              // `class_content_reports` em lugar nenhum, e a hora
                              // destas aulas JÁ conta enquanto elas estão
                              // `scheduled` (aula passada, contrato não pausado). O
                              // que o apontamento trava é o `complete_class`, ou
                              // seja o REGISTRO — não o pagamento.
                              ` ${frasePendentes(foraDoLote)} desta fila NÃO entra${foraDoLote > 1 ? 'm' : ''}: está${foraDoLote > 1 ? 'ão' : ''} sem apontamento do que foi trabalhado, e o banco recusa registrar realizada sem ele. Registre o apontamento dela${foraDoLote > 1 ? 's' : ''} primeiro — a hora dessas aulas já conta no extrato da professora mesmo sem registro (quando o contrato não está pausado); o que falta é o desfecho.`
                            : '')
                        }
                        confirmar="Confirmar registro em lote"
                        action={completeAllPendingAction}
                        campos={{
                          teacher_id: estado.professora,
                          // Rodada 3 do Sol: o lote viaja com os IDs EXATOS que
                          // esta tela mostrou — a RPC valida um a um, e aula que
                          // terminar entre o render e o submit não entra mais.
                          // 29/07: e SÓ os que podem concluir (têm apontamento).
                          instance_ids: doLote.map((r) => r.id).join(','),
                          back: self,
                        }}
                        className={`${btnInkA3} self-start`}
                      />
                      {foraDoLote > 0 && (
                        <p className="text-sm text-ink-600">
                          {/* o número é DADO: é ele que explica por que o botão
                              conta menos do que a lista abaixo mostra */}
                          <strong className="font-semibold text-ink-900">
                            {frasePendentes(foraDoLote)}
                          </strong>{' '}
                          desta fila fica{foraDoLote > 1 ? 'm' : ''} de fora do lote — sem apontamento
                          do que foi trabalhado. Registre o apontamento e ela
                          {foraDoLote > 1 ? 's entram' : ' entra'} na próxima vez.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-600">
                      {/* A5/L5: mesma correção do aviso do botão — o apontamento
                          trava o REGISTRO (`complete_class` recusa), não o
                          pagamento. E o caminho unitário deixou de ser um botão:
                          é a linha “A aula aconteceu” da matriz. */}
                      Nenhuma destas aulas pode ser registrada em lote: todas estão{' '}
                      <strong className="font-semibold text-ink-900">sem apontamento</strong> do que foi
                      trabalhado, e o banco recusa registrar realizada sem ele. Registre o apontamento
                      (aqui, na opção “A aula aconteceu” de cada uma, ou pela professora no painel
                      dela) e o lote volta a aparecer.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-ink-600">
                    Para registrar em lote,{' '}
                    <strong className="font-semibold text-ink-900">filtre por professora</strong> na barra
                    acima — o atestado em massa é por professora.
                  </p>
                )}
                {/* A FILA, NUMA MOLDURA SÓ — e a MAIS ANTIGA GRITA PRIMEIRO (A7).
                    · a ordem já vinha certa da camada de dados (`inicioUtc`
                      crescente, janela fixa de 60 dias);
                    · o que faltava era a HIERARQUIA: eram N cartões soltos, do
                      mesmo tamanho e com o mesmo chip âmbar, e a dívida de 20
                      dias parecia igual à de ontem. Agora é uma lista única
                      (o mesmo esqueleto da visão-lista), a linha do TOPO leva o
                      rótulo do lugar dela e o chip do atraso escala com o
                      atraso REAL: uma semana ou mais fica vermelho.
                    O tom sai de `atrasoDias`, que é a mesma conta que escreve a
                    frase — não de um parse da frase pronta. */}
                <ul className="divide-y divide-line-soft overflow-visible rounded-card border border-line-soft bg-paper-0">
                  {agenda.pendencias.map((r, i) => (
                  <li
                    key={r.id}
                    className={`flex flex-col gap-3 border-l-2 p-4 ${TEACHER_EDGE[r.teacherIdx % TEACHER_EDGE.length]}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                      <div className="min-w-0">
                        {/* A DA FRENTE É A MAIS VELHA: um degrau de tamanho
                            marca isso sem apagar as outras (a régua distingue
                            por PESO/tamanho, nunca por tinta apagada). */}
                        {r.studentId ? (
                          <Link
                            href={`/admin/alunos/${r.studentId}`}
                            className={`font-semibold text-ink-900 hover:underline ${i === 0 ? 'text-base' : 'text-sm'}`}
                          >
                            {r.quem}
                          </Link>
                        ) : (
                          <span
                            className={`font-semibold text-ink-900 ${i === 0 ? 'text-base' : 'text-sm'}`}
                          >
                            {r.quem}
                          </span>
                        )}
                        <p className="text-sm text-ink-600 first-letter:uppercase">
                          {r.instante.texto}
                          {r.teacherNome && (
                            <span
                              className={`whitespace-nowrap ${TEACHER_TEXT[r.teacherIdx % TEACHER_TEXT.length]}`}
                            >
                              {' '}
                              · {r.teacherNome}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="flex items-center gap-2">
                        {/* RÓTULO do lugar na fila — só na primeira, e só quando
                            há mais de uma (dizer "a mais antiga" de uma lista de
                            um é dizer nada). */}
                        {i === 0 && agenda.pendencias.length > 1 && (
                          <span className="text-sm text-ink-600">a mais antiga</span>
                        )}
                        <Pill tone={ehAtrasoGrave(r.atrasoDias) ? 'danger' : 'warn'}>{r.atraso}</Pill>
                      </span>
                    </div>
                    {/* A MATRIZ, na pele larga (A5/L3). Aqui morreu o trio do
                        `pieces.tsx`: três formulários soltos mais o
                        `<details data-popup>` do cancelamento, sem nenhuma
                        consequência escrita e com a decisão de dinheiro (quem
                        cancelou) escondida num select nativo. O `?ev=` do
                        `back_erro` não abre balão nesta visão — não há grade —,
                        mas é ele que diz de QUEM é o rascunho a restaurar. */}
                    <DesfechoDaAula
                      aulaId={r.id}
                      situacao={r.situacao}
                      temApontamento={r.temApontamento}
                      back={self}
                      backErro={focoHref(r.id)}
                      digitado={digitadoDaAula(r.id)}
                      agoraNoNegocio={agoraNoNegocio}
                      entregabilidade={{ temLogin: r.temLogin, temWhatsapp: r.temWhatsapp }}
                      pele="largo"
                    />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : agenda.visao === 'lista' ? (
          <section className="flex flex-col gap-4 p-5">
            <form method="get" action="/admin/agenda" className="max-w-sm">
              <input type="hidden" name="v" value="lista" />
              {estado.professora && <input type="hidden" name="prof" value={estado.professora} />}
              <input
                type="search"
                name="q"
                defaultValue={estado.busca ?? ''}
                placeholder="Buscar aluno pelo nome…"
                aria-label="Buscar aluno (Enter para filtrar)"
                className={`${input} w-full`}
              />
            </form>
            {agenda.porDia.length === 0 ? (
              <EmptyState
                illustration="/illustrations/agenda-vazia.svg"
                title={estado.busca ? `Nada encontrado para “${estado.busca}”.` : 'Nenhuma aula agendada nos próximos 14 dias.'}
                hint={
                  estado.busca
                    ? 'Confira a grafia ou limpe a busca para ver todas as aulas.'
                    : 'As aulas nascem dos horários fixos dos contratos — confira em Contratos se algum horário está faltando.'
                }
                cta={estado.busca ? 'Limpar busca' : 'Ver contratos'}
                href={estado.busca ? comMudanca(estado, { busca: undefined }, agenda.hojeISO) : '/admin/alunos/contratos'}
              />
            ) : (
              agenda.porDia.map((dia) => (
                <section key={dia.iso}>
                  <h4 className="px-1 text-sm font-semibold text-ink-600 first-letter:uppercase">
                    {dia.titulo}{' '}
                    {/* contagem do dia é DADO ("X de Y" é dado inclusive com X=0) */}
                    <span className="font-semibold tabular-nums text-ink-900">
                      · {dia.aulas.length} aula{dia.aulas.length > 1 ? 's' : ''}
                    </span>
                  </h4>
                  <ul className="mt-1.5 divide-y divide-line-soft overflow-visible rounded-card border border-line-soft bg-paper-0">
                    {dia.aulas.map((r) => (
                      <li
                        key={r.id}
                        className={`flex flex-wrap items-center justify-between gap-3 border-l-2 px-4 py-2.5 ${TEACHER_EDGE[r.teacherIdx % TEACHER_EDGE.length]}`}
                      >
                        <div className="flex min-w-0 items-baseline gap-3 text-sm">
                          <span className="font-mono text-sm font-semibold text-ink-900">{r.hora}</span>
                          {r.studentId ? (
                            <Link
                              href={`/admin/alunos/${r.studentId}`}
                              className="truncate font-semibold text-ink-900 hover:underline"
                            >
                              {r.quem}
                            </Link>
                          ) : (
                            <span className="truncate font-semibold text-ink-900">{r.quem}</span>
                          )}
                          <span
                            className={`hidden text-sm sm:inline ${TEACHER_TEXT[r.teacherIdx % TEACHER_TEXT.length]}`}
                          >
                            {r.teacherNome ?? '—'}
                          </span>
                        </div>
                        <Actions label="gerir">
                          <div className="flex w-56 flex-col gap-2">
                            <Link href={`/admin/agenda/remarcar/${r.id}`} className={`${btnInkA3} w-full`}>
                              Remarcar…
                            </Link>
                            {/* O `<details data-popup>` de cancelar MORREU aqui
                                (A5/L3) e NÃO foi trocado por um clone da matriz
                                dentro de um menu: formulário com radio dentro de
                                menu é teclado quebrado (é a razão pela qual o
                                `kit/popover.tsx` existe). O cancelamento é uma
                                decisão de dinheiro e acontece onde a
                                consequência está escrita: a linha leva à grade
                                do dia com o balão desta aula JÁ ABERTO (`?ev=`),
                                na aba Desfecho. Um clique a mais, com a
                                consequência à vista — e uma superfície a menos
                                para a frase de dinheiro divergir. */}
                            <Link
                              href={diaComFoco(dia.iso, r.id)}
                              className={`${btnPaperA5} w-full`}
                            >
                              Cancelar aula…
                            </Link>
                          </div>
                        </Actions>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </section>
        ) : (
          <div className="flex flex-col gap-3 p-5">
            {/* O provedor mora AQUI, uma vez, em volta da grade: é ele que faz o
                conteúdo do balão parar de multiplicar por 224 (a dívida dos
                Popover Roots declarada no A2 — medição e decisão no goal). */}
            <ProvedorDoSlot dados={dadosDoSlot}>
              <Calendario
                events={[...eventos, ...eventosDeJanela, ...camadaDeDisponibilidade]}
                view={agenda.visao as 'mes' | 'semana' | 'dia'}
                anchor={agenda.ancora}
                tz={BUSINESS_TZ}
                dayHref={diaHref}
                todayISO={agenda.hojeISO}
                slotAberto={balaoAberto ?? undefined}
                eventoAberto={emFoco ?? undefined}
                slotPopup={
                  // O BOTÃO "COM JANELAS" NÃO GOVERNA MAIS ISTO (A4). Ele diz se
                  // a camada de horários publicados APARECE na grade — e estava
                  // decidindo também se a dona PODE agir no vazio: com a camada
                  // desligada, tocar numa meia-hora não fazia nada. Ver e poder
                  // são coisas diferentes; o balão existe sempre que houver
                  // grade de horas (o mês não tem meia-hora para tocar).
                  agenda.visao !== 'mes'
                    ? (iso, hhmm) => (
                        // O dia vai ESCRITO daqui: cliente não formata data
                        // (Lei 1/lint da casa), e foi ISO cru vazando numa frase
                        // para a dona o defeito que o A1 já pagou uma vez. O
                        // INSTANTE em UTC também sai daqui, pela mesma razão: é
                        // dele que o balão tira o equivalente local do fuso do
                        // aluno sem calcular fuso no navegador (grave 3).
                        <IntencoesDoSlot
                          iso={iso}
                          hhmm={hhmm}
                          titulo={formatarDiaCurto(iso)}
                          instanteUtc={instanteDoSlot(iso, hhmm)}
                        />
                      )
                    : undefined
                }
              />
            </ProvedorDoSlot>
            {/* LEGENDA — a cor é da professora (aqui ilustrada com --t0); o
                estado é o acento ortogonal. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] bg-(--t0-fill) align-[-1px]" /> aula
                agendada
              </span>
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] border-l-2 border-l-danger-700 bg-(--t0-tint) align-[-1px]" />{' '}
                <span className="font-bold text-danger-700">✕</span> falta
              </span>
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] border-l-2 border-l-warn-700 bg-(--t0-tint) align-[-1px]" />{' '}
                <span className="rounded-[3px] bg-warn-700 px-1 text-[9px] font-bold text-white">?</span> sem
                registro
              </span>
              <span>
                <span className="font-bold text-ok-700">✓</span> realizada
              </span>
              <span className="line-through">riscada = cancelada/remarcada</span>
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] border border-dashed border-(--t0-fill) bg-(--t0-tint) align-[-1px]" />{' '}
                horário aberto
              </span>
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] border border-dashed border-(--t0-fill) bg-paper-0 align-[-1px]" />{' '}
                horário usado
              </span>
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] bg-paper-100 align-[-1px]" /> agenda
                pessoal
              </span>
              {camadaAtiva && (
                <>
                  <span>
                    {/* o swatch veste o tint da PROFESSORA FILTRADA — a mesma
                        cor da camada na grade (item 9; --t0 fixo mentia para
                        qualquer professora de índice ≠ 0). O do bloqueio segue
                        BLOCKED_BG: a hachura é neutra por desenho, sem cor. */}
                    <span
                      className={`mr-1 inline-block h-2.5 w-2.5 rounded-[3px] opacity-50 align-[-1px] ${TEACHER_TINT[idxDaFiltrada % TEACHER_TINT.length]}`}
                    />{' '}
                    disponibilidade da professora
                  </span>
                  <span>
                    <span className={`mr-1 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px] ${BLOCKED_BG}`} />{' '}
                    bloqueio — sem oferta
                  </span>
                </>
              )}
              {googleIndisponivel && <span>· agenda pessoal do Google indisponível agora</span>}
            </div>
          </div>
        )}
      </CardPanel>

      {/* ------------------------------------------------ painéis de criação */}
      {novo === 'avulsa' && (
        <PainelDeUrl
          titulo="Aula avulsa"
          descricao="Uma aula fora dos horários fixos, para quem já é aluno: extra cobrada à parte ou cortesia."
          voltarPara={self}
        >
          {/* A MESMA PEÇA DO BALÃO (Sol · rodada 2 do A4, grave 3). Este painel
              tinha campos PRÓPRIOS: ele recebia `nd`/`nt` — a data e a hora que
              a dona tocou na GRADE, ou seja, em Cuiabá — e nunca recalculava ao
              escolher o contrato. Um link salvo com `nd=2026-08-04&nt=14:00` mais
              um contrato de São Paulo criava a aula às 14:00 de São Paulo: 13:00
              no ponto tocado. Agora as duas portas são a mesma peça, e a
              conferência de fuso da action vale para as duas.
              (A cortesia que DESMONTA o campo Valor — grave 1 da rodada 1 —
              continua dentro dela, no `TipoEValorDaAvulsa`.) */}
          <form action={createSingleClassAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <CamposDaAvulsa
                contratos={agenda.contratos}
                digitado={digitadoDaAvulsa}
                instanteUtc={instanteDoPrefill}
                horaNaGrade={prefillTime ?? null}
                dataInicial={prefillDate}
                horaInicial={prefillTime}
              />
            </div>
            <input type="hidden" name="back" value={self} />
            <input type="hidden" name="back_erro" value={painelDeErro('avulsa')} />
            <button type="submit" className={`${btnInk} w-full`}>
              Criar aula avulsa
            </button>
            <p className="text-sm text-ink-600">
              É uma pessoa nova, ainda não aluna?{' '}
              <Link href={novoHref('experimental')} className="font-semibold text-ac-deep hover:underline">
                Criar aula experimental →
              </Link>
            </p>
          </form>
        </PainelDeUrl>
      )}

      {novo === 'experimental' && (
        <PainelDeUrl
          titulo="Aula experimental"
          descricao="Para quem ainda não é aluno: cria a pessoa e um contrato leve junto — uma aula só, sem horários fixos nem 8 semanas geradas."
          voltarPara={self}
        >
          <form action={createTrialClassAction} className="flex flex-col gap-4">
            {/* A MESMA PEÇA DO BALÃO (grave 3) — trocar a cidade da pessoa
                recalcula data e hora a partir do ponto tocado na grade. */}
            <div className="flex flex-col gap-3">
              <CamposDaExperimental
                professoras={professorasDoSlot}
                professoraFiltrada={null}
                digitado={rascunhoDoPainel}
                instanteUtc={instanteDoPrefill}
                horaNaGrade={prefillTime ?? null}
                dataInicial={prefillDate}
                horaInicial={prefillTime}
              />
            </div>
            <input type="hidden" name="back" value={self} />
            <input type="hidden" name="back_erro" value={painelDeErro('experimental')} />
            <button type="submit" className={`${btnInk} w-full`}>
              Criar experimental
            </button>
            <p className="text-sm text-ink-600">
              Já é aluno da escola?{' '}
              <Link href={novoHref('avulsa')} className="font-semibold text-ac-deep hover:underline">
                Criar aula avulsa →
              </Link>
            </p>
          </form>
        </PainelDeUrl>
      )}

      {novo === 'horario' && (
        <PainelDeUrl
          titulo="Horário aberto"
          descricao="Oferta um horário de remarcação. Os alunos da professora só conseguem usá-lo dentro das próximas 2 semanas."
          voltarPara={self}
        >
          <form action={publishWindowAction} className="flex flex-col gap-4">
            <input type="hidden" name="back" value={self} />
            <input type="hidden" name="back_erro" value={painelDeErro('horario')} />
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <Field label="Professora">
                <select
                  name="teacher_id"
                  required
                  defaultValue={digitado('teacher_id') ?? estado.professora ?? ''}
                  className={input}
                >
                  <option value="">Escolha…</option>
                  {agenda.professoras.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Data">
                <DateField name="local_date" required defaultValue={digitado('local_date') ?? prefillDate} />
              </Field>
              <Field label="Hora (Cuiabá)">
                <TimeField name="local_time" required defaultValue={digitado('local_time') ?? prefillTime} />
              </Field>
            </div>
            <button type="submit" className={`${btnInk} w-full`}>
              Publicar horário
            </button>
            <p className="text-sm text-ink-600">
              Atalho: clicar numa meia-hora vazia da grade já traz data e hora preenchidas.
            </p>
          </form>
        </PainelDeUrl>
      )}

      {novo === 'disponibilidade' && (
        <PainelDeUrl
          titulo="Disponibilidade e bloqueios"
          descricao="A agenda semanal da professora e os períodos em que nada é ofertado. A grade mostra a camada quando uma professora está filtrada."
          voltarPara={self}
        >
          {!estado.professora || !agenda.disponibilidade ? (
            // MESMA chave da camada (decisão registrada no goal): sem select
            // próprio aqui — o filtro da barra é quem escolhe a professora,
            // no mesmo padrão do lote de pendências.
            <p className="text-sm text-ink-600">
              Para editar,{' '}
              <strong className="font-semibold text-ink-900">filtre por professora</strong> na barra
              acima — janelas e bloqueios são sempre de uma professora, e a grade passa a mostrar a
              camada dela.
            </p>
          ) : (
            <div className="flex flex-col gap-7">
              {/* QUEM está sendo editada (Sol · rodada 1 do A3, item 6 — grave):
                  o painel mexe na agenda de UMA pessoa e abria sem contexto —
                  no celular dava para remover a janela da professora errada.
                  Nome em destaque (DADO) + o fuso DELA em CIDADE (nunca IANA
                  cru), valendo para as duas seções abaixo. */}
              <p className="text-sm font-medium text-ink-900">
                <span className="font-semibold">{agenda.disponibilidade.professora.nome}</span> · fuso
                de {agenda.disponibilidade.professora.cidade}
              </p>
              {/* headings UM degrau abaixo do título do painel (SheetTitle é
                  <h2> — item 12: h4 pulava nível dentro do PainelDeUrl) */}
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-ink-900">Janelas semanais</h3>
                <p className="text-sm text-ink-600">
                  A janela vale no fuso da própria professora e alimenta os horários ofertáveis aos
                  alunos.
                </p>
                {agenda.disponibilidade.janelas.length > 0 ? (
                  <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0">
                    {agenda.disponibilidade.janelas.map((j) => (
                      <li key={j.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        {/* dia e horário são DADO (régua AGENTS.md) */}
                        <span className="text-sm font-medium text-ink-900 first-letter:uppercase">
                          {j.rotulo}
                        </span>
                        <form action={removeWeeklyAvailabilityAction}>
                          <input type="hidden" name="id" value={j.id} />
                          <input type="hidden" name="back" value={self} />
                          <input type="hidden" name="back_erro" value={painelDeErro('disponibilidade')} />
                          {/* AÇÃO parece ação (tela nova): chip com alvo ≥24px,
                              não link textual puro. Nome acessível DISTINTIVO
                              (item 11): numa lista, sete "Remover" iguais não
                              dizem ao leitor de tela QUAL janela cai. */}
                          <button
                            type="submit"
                            aria-label={`Remover janela de ${j.rotulo}`}
                            className="inline-flex min-h-6 items-center rounded-chip px-2 text-sm font-semibold text-danger-700 hover:bg-paper-100"
                          >
                            Remover
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-600">Nenhuma janela semanal cadastrada.</p>
                )}
                <form action={addWeeklyAvailabilityAction} className="flex flex-col gap-3">
                  <input type="hidden" name="teacher_id" value={estado.professora} />
                  <input type="hidden" name="back" value={self} />
                  <input type="hidden" name="back_erro" value={painelDeErro('disponibilidade')} />
                  <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                    <Field label="Dia da semana">
                      {/* VALUES da convenção do banco: 1=seg … 6=sáb, 0=dom */}
                      <select name="weekday" required defaultValue={digitado('weekday') ?? ''} className={input}>
                        <option value="">Escolha…</option>
                        <option value="1">segunda</option>
                        <option value="2">terça</option>
                        <option value="3">quarta</option>
                        <option value="4">quinta</option>
                        <option value="5">sexta</option>
                        <option value="6">sábado</option>
                        <option value="0">domingo</option>
                      </select>
                    </Field>
                    <Field label="Início (fuso da professora)">
                      <TimeField name="start_local" required defaultValue={digitado('start_local')} />
                    </Field>
                    <Field label="Fim">
                      <TimeField name="end_local" required defaultValue={digitado('end_local')} />
                    </Field>
                  </div>
                  <button type="submit" className={`${btnInkA3} self-start`}>
                    Criar janela semanal
                  </button>
                </form>
              </section>

              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-ink-900">Bloqueios</h3>
                <p className="text-sm text-ink-600">
                  O bloqueio impede horários NOVOS no período e fecha os horários de
                  remarcação já publicados dentro dele; aulas já marcadas continuam —
                  trate-as em Período ou férias.
                </p>
                {agenda.disponibilidade.bloqueios.length > 0 ? (
                  <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0">
                    {agenda.disponibilidade.bloqueios.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          {/* período E nota são DADO (Sol · rodadas 2 e 3 do
                              A3): a nota é o que distingue qual bloqueio
                              remover quando as datas coincidem — os DOIS no
                              piso LITERAL da régua do AGENTS.md
                              (text-sm font-medium text-ink-900); ink-600 é
                              piso de RÓTULO, não de dado */}
                          <p className="text-sm font-medium text-ink-900">{b.resumo}</p>
                          {b.note && <p className="text-sm font-medium text-ink-900">{b.note}</p>}
                        </div>
                        <form action={removeTeacherBlockAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="back" value={self} />
                          <input type="hidden" name="back_erro" value={painelDeErro('disponibilidade')} />
                          <button
                            type="submit"
                            aria-label={`Remover bloqueio ${b.resumo}${b.note ? ` — ${b.note}` : ''}`}
                            className="inline-flex min-h-6 items-center rounded-chip px-2 text-sm font-semibold text-danger-700 hover:bg-paper-100"
                          >
                            Remover
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-600">Nenhum bloqueio à frente.</p>
                )}
                <form action={addTeacherBlockAction} className="flex flex-col gap-3">
                  <input type="hidden" name="teacher_id" value={estado.professora} />
                  <input type="hidden" name="back" value={self} />
                  <input type="hidden" name="back_erro" value={painelDeErro('disponibilidade')} />
                  <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                    <Field label="De (fuso da professora)">
                      <DateField name="from" required defaultValue={digitado('from')} />
                    </Field>
                    <Field label="Até (inclusive)">
                      <DateField name="to" required defaultValue={digitado('to')} />
                    </Field>
                  </div>
                  <Field label="Motivo (opcional)" hint="aparece na grade — ex.: férias">
                    <input name="note" placeholder="férias" defaultValue={digitado('note') ?? ''} className={input} />
                  </Field>
                  <button type="submit" className={`${btnInkA3} self-start`}>
                    Criar bloqueio
                  </button>
                </form>
              </section>
            </div>
          )}
        </PainelDeUrl>
      )}
    </main>
  )
}
