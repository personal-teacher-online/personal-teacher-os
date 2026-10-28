// CALENDÁRIO DO KIT (Onda da Agenda · A2) — o gêmeo do admin.
//
// FORK, não mudança de endereço: `src/components/CalendarGrid.tsx` continua
// servindo `/teacher` até a onda da professora (a regra de convivência da IA
// substitui o front POR SEÇÃO). O MOTOR daqui é o mesmo de lá — provado em
// produção — e qualquer conserto de motor feito AQUI precisa ser espelhado ou
// anotado LÁ (risco 3 do goal da onda: senão o bug ressuscita no painel dela).
//
// O que este fork muda é a PELE, para a régua MEDIDA do TutorBird
// (`docs/goals/mapeamento-tutorbird-2.md`):
//   · cabeçalho dos dias e número do dia em 14px na tinta forte — o `#344242`
//     medido traduz para o token `text-ink-900` (hex cru é proibido);
//   · hoje = círculo da MARCA (`bg-ac-deep`), nos três lugares (cabeçalho da
//     grade de horas, grade do mês e faixa de dias do celular);
//   · célula do mês na altura medida (~133px).
// O resto da pele (bordas, sombras, chips) segue o kit como já estava, e a
// matriz M-AG fica intacta: a cor é sempre da professora (única dimensão de
// cor); os estados são sinais ortogonais que nunca repintam o fundo.
// EXCEÇÃO DESENHADA (única) ao "nunca repinta o fundo": a janela de remarcação
// CONSUMIDA (dashed+dim) fica OCA — interior branco (`bg-paper-0`) contra o
// interior tingido da publicada. Ali o interior É o sinal, porque opacidade no
// contêiner esmaeceria borda/texto/popover abaixo de contraste AA (racional
// documentado no gêmeo); a identidade da professora sobrevive na borda tracejada.
//
// DECISÕES DA RODADA 2 DO SOL REGISTRADAS SEM MUDANÇA (triagem no goal
// `docs/goals/onda-agenda.md` §A2): o número do dia em 32×32px cumpre a lei da
// casa de alvo (≥24px — o "44px móvel" cobrado é régua externa); o
// `hideWhenDetached` do Popover do kit fica (limitação rara; o e2e do A9
// exercita o comportamento real); e a hora repetida do fall-back NÃO ocorre
// neste fork — a grade do admin exibe em America/Cuiaba, sem DST; o quirk
// pertence à onda da professora (fuso próprio, F3-D2).
//
// ADIÇÃO DO FORK (A3, recurso novo — NÃO é conserto de motor, logo SEM
// espelhamento no gêmeo): o sinal `blocked` — bloqueio da professora como
// camada de fundo com identidade própria (hachura neutra + rótulo no piso de
// DADO), distinto do ghost do Google. Ver o comentário do campo em `CalEvent`.
//
// ADIÇÃO DO FORK (A4, recurso novo — SEM espelhamento no gêmeo): `slotAberto`,
// a meia-hora cujo balão já nasce ABERTO. Ela existe por causa da volta de erro
// das três intenções do slot (`IntencoesDoSlot`): sem isso, uma recusa do banco
// fechava o balão e apagava a intenção inteira. O `title` do gatilho deixou de
// dizer "Publicar às HH:mm" (uma das três) e passou a "Criar às HH:mm".
//
// ADIÇÃO DO FORK (A5, recurso novo — SEM espelhamento no gêmeo): `eventoAberto`,
// o EVENTO cujo balão já nasce aberto (`?ev=<id>`), e o balão do evento passando
// a ser o `BalaoDoSlot` (abertura controlada). Existe pela mesma razão do
// `slotAberto`: o balão da aula hospeda a matriz do desfecho, que é formulário —
// uma recusa do banco não pode fechar o balão e apagar a escolha. E, com ela,
// vem de graça o conserto do médio 3 do A4 aplicado aqui: na semana só a grade
// visível abre. A largura do balão de aula vem do kit
// (`LARGURA_DO_BALAO_DE_AULA`) porque ele é montado em DOIS lugares — grade de
// horas e mês — e duas larguras para o mesmo balão ninguém vê no diff.
//
// E os POPUPS: os `<details data-popup>` MORRERAM (proibidos em tela nova pelo
// `AGENTS.md` — sem foco preso, sem Esc, sem devolução de foco). Popup de
// evento e popup de slot vazio agora são o Popover do kit
// (`src/components/kit/popover.tsx`), que nasceu no A1 exatamente para isto.
// O posicionamento manual por coluna do mês (`right-0`/`left-0` por índice)
// morreu junto: a colisão é do Radix (`collisionPadding` já vem do kit).
// O CONTEÚDO dos popups continua exatamente o que era — A4/A5 é que redesenham.
//
// POR QUE NÃO HÁ `'use client'` AQUI: a API recebe FUNÇÕES da página
// (`dayHref`, `slotHref`, `slotPopup`), e função não atravessa a fronteira
// server→client do Next. Este módulo continua sendo Server Component e COMPÕE
// os primitivos cliente de `kit/popover.tsx`, passando os popups (ReactNode
// renderizados no servidor) como children — o mesmo padrão RSC do
// `PainelDeUrl`. Bônus deliberado: o Luxon daqui segue em módulo de servidor.
//
// Lei 1: Luxon SÓ formata/particiona para exibição — os instantes chegam em UTC.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { DateTime } from 'luxon'

import { LARGURA_DO_BALAO_DE_AULA } from '@/components/kit/popover'
import { BalaoDoSlot, type VarianteDaGrade } from '@/components/kit/balao-do-slot'
import { TEACHER_FILL, TEACHER_TINT, TEACHER_TEXT, TEACHER_BORDER, TEACHER_EDGE } from '@/components/ui'

export interface CalEvent {
  id: string
  startsAtUtc: string
  /** ausente → 45min (janelas de remarcação não têm fim registrado) */
  endsAtUtc?: string | null
  title: string
  /** índice da professora → cor (TEACHER_* do ui.tsx) */
  color: number
  /** realizada: tinta suave com ✓ */
  dim?: boolean
  /** cancelada/remarcada: riscada, neutra */
  strike?: boolean
  /** FALTA (no_show_* — desfecho TERMINAL, dinheiro): acento DANGER (borda-esq.
   *  danger + marcador ✕) SOBRE a tinta da professora. Estado ortogonal: a cor
   *  da professora sobrevive; distinto de "sem registro" (warn). */
  falta?: boolean
  /** SEM REGISTRO (aula passada scheduled — dívida operacional): acento WARN
   *  (borda-esq. warn + marcador ?) sobre a tinta da professora. Ortogonal:
   *  mantém a cor da professora de fundo; distinto de FALTA (danger). */
  warn?: boolean
  /** compromisso do Google: pano de fundo discreto */
  ghost?: boolean
  /** janela de remarcação: borda tracejada na cor da professora */
  dashed?: boolean
  /** disponibilidade semanal (item 14.5): lavagem de fundo estilo "expediente"
   *  do Google — sem rótulo, sem clique; só contexto atrás das aulas */
  avail?: boolean
  /** A3 (ADIÇÃO do fork — recurso novo, sem espelhamento no gêmeo): bloqueio
   *  da professora. Camada de FUNDO como `avail`/ghost-sem-popup
   *  (pointer-events-none, sem lane; o slot vazio embaixo segue vivo), mas com
   *  identidade própria: hachura neutra (tokens paper/line — nunca cor de
   *  professora, distinta do `bg-paper-100/90` chapado do ghost) e o `title`
   *  visível no piso de DADO ("bloqueada" muda a decisão sobre o dia). */
  blocked?: boolean
  /** sufixo do hover nativo (title) — ex.: hora local do aluno (F0/M1-extras) */
  hoverExtra?: string
  /** conteúdo do popup (dados + forms de ação, montados pela página) */
  popup?: ReactNode
}

interface Props {
  events: CalEvent[]
  view: 'mes' | 'semana' | 'dia'
  /** âncora 'yyyy-LL-dd' interpretada no fuso de exibição */
  anchor: string
  /** fuso de exibição (negócio no admin) */
  tz: string
  /** monta o link da visão-dia de uma data */
  dayHref: (dateISO: string) => string
  /** 'yyyy-LL-dd' de hoje no fuso de exibição */
  todayISO: string
  /** meia-hora VAZIA vira link (ex.: publicar janela ali) — semana/dia */
  slotHref?: (dateISO: string, timeHHmm: string) => string
  /** item 14.3 (quick-create do Google): meia-hora vazia abre POPOVER no local
   *  com o mini-form pronto (data/hora já embutidas) — sem reload, sem viajar
   *  para o formulário do topo. Quando presente, substitui o slotHref. */
  slotPopup?: (dateISO: string, timeHHmm: string) => ReactNode
  /** A4 — 'yyyy-LL-ddTHH:mm' do slot que já nasce ABERTO. Serve à volta de erro:
   *  a action devolve a dona para a mesma tela com o balão daquele horário
   *  reaberto e o que ela digitou de volta nos campos. Sem isto, um erro do
   *  banco fechava o balão e apagava a intenção inteira. */
  slotAberto?: string
  /** A5 — o `id` do EVENTO cujo balão já nasce aberto (`?ev=` na URL), pela mesma
   *  razão e com o mesmo mecanismo do `slotAberto`: a matriz do desfecho é
   *  formulário, e um erro do banco não pode fechar o balão e apagar a escolha.
   *  Evento que não está na faixa visível simplesmente não abre nada. */
  eventoAberto?: string
}

const HOUR_PX = 64 // item 14.8: linha de hora mais alta (nomes completos, blocos legíveis)
const WEEKDAYS_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] // item 14.2: semana na segunda

interface Placed {
  ev: CalEvent
  start: DateTime
  end: DateTime
}

function place(ev: CalEvent, tz: string): Placed {
  const start = DateTime.fromISO(ev.startsAtUtc).setZone(tz)
  const end = ev.endsAtUtc ? DateTime.fromISO(ev.endsAtUtc).setZone(tz) : start.plus({ minutes: 45 })
  return { ev, start, end }
}

/** Lanes gulosas para eventos sobrepostos no mesmo dia (professoras em paralelo). */
function lanes(items: Placed[]): Map<string, { lane: number; of: number }> {
  const sorted = [...items].sort((a, b) => a.start.toMillis() - b.start.toMillis())
  const laneEnd: number[] = []
  const pos = new Map<string, { lane: number; of: number }>()
  let group: { id: string; lane: number }[] = []
  let groupMaxLane = 0
  let openUntil = 0
  const flush = () => {
    for (const g of group) {
      const p = pos.get(g.id)
      if (p) p.of = groupMaxLane + 1
    }
    group = []
    groupMaxLane = 0
    laneEnd.length = 0
  }
  for (const it of sorted) {
    if (it.start.toMillis() >= openUntil && group.length > 0) flush()
    let lane = laneEnd.findIndex((end) => end <= it.start.toMillis())
    if (lane === -1) lane = laneEnd.length
    laneEnd[lane] = it.end.toMillis()
    pos.set(it.ev.id, { lane, of: 1 })
    group.push({ id: it.ev.id, lane })
    groupMaxLane = Math.max(groupMaxLane, lane)
    openUntil = Math.max(openUntil, it.end.toMillis())
  }
  flush()
  return pos
}

/** Minutos CIVIS desde a meia-noite do dia de exibição (Sol · rodada 2 do A3,
 *  defeito 1): a meia-noite do dia SEGUINTE é 1440, nunca "hora 0" — ler
 *  `end.hour` fazia o pedaço que termina à meia-noite (Lisboa sáb 22:00→24:00)
 *  colapsar no clamp (`fim <= início`) e SUMIR da grade. Conta CIVIL (hora do
 *  rótulo), não diff real: a grade posiciona por rótulo de hora, e isso vale
 *  igual num dia com transição de DST no fuso de exibição. Fora do dia, preso
 *  a [0, 1440]. Declarado (Sol · rodada 3 do A3): na hora REPETIDA do
 *  fall-back um pedaço de fundo real (01:30 EDT → 01:30 EST) colapsa no MESMO
 *  minuto civil e é descartado pelo clamp — FORA DO HORIZONTE OPERACIONAL no
 *  admin (não "inalcançável": Cuiabá TEM fall-back histórico no tzdata,
 *  fev/2019, e a URL da agenda navega para trás sem trava — só não há
 *  transição FUTURA enquanto o Brasil seguir sem DST); o quirk pertence à
 *  onda da professora (fuso próprio, F3-D2), junto do precedente da hora
 *  repetida citado no cabeçalho. */
function minutosNoDia(t: DateTime, meiaNoite: DateTime): number {
  if (t.hasSame(meiaNoite, 'day')) return t.hour * 60 + t.minute
  return t < meiaNoite ? 0 : 1440
}

/** Um intervalo em MINUTOS CIVIS do dia de exibição, fim EXCLUSIVO. */
interface Faixa {
  ini: number
  fim: number
}

/** Sobreposição REAL de intervalos — nada de "zona de rótulo". */
function seSobrepoem(a: Faixa, b: Faixa): boolean {
  return a.ini < b.fim && a.fim > b.ini
}

/**
 * O MAIOR pedaço de `alvo` que sobra depois de subtrair `cobridores`; `null`
 * quando nada sobra (o alvo está inteiramente coberto).
 *
 * PORTÃO DE DEPLOY 29/07 (achado 7). A cobertura que decide se um fundo
 * INTERATIVO continua clicável era calculada pela ZONA DE RÓTULO (os 20 min
 * iniciais), e errava nos dois sentidos em sobreposição parcial:
 *   · ghost 09:00–11:00 sob bloqueio 10:00–12:00 dava "não coberto" — o toque
 *     atravessava a hachura às 10:30 e abria um popover invisível;
 *   · ghost 09:00–12:00 sob bloqueio 09:00–09:30 dava "coberto" — o trecho
 *     VISÍVEL das 09:30 às 12:00 perdia o gatilho inteiro.
 * A conta certa não é um sim/não sobre o rótulo: é a sobreposição de intervalo.
 * O gatilho encolhe para o que continua à vista e só MORRE quando não sobra
 * nada — as duas metades do defeito de uma vez.
 */
function trechoVisivel(alvo: Faixa, cobridores: Faixa[]): Faixa | null {
  const relevantes = cobridores.filter((c) => seSobrepoem(c, alvo)).sort((x, y) => x.ini - y.ini)
  let melhor: Faixa | null = null
  const considerar = (ini: number, fim: number) => {
    if (fim <= ini) return
    if (melhor === null || fim - ini > melhor.fim - melhor.ini) melhor = { ini, fim }
  }
  let cursor = alvo.ini
  for (const c of relevantes) {
    considerar(cursor, Math.min(c.ini, alvo.fim))
    cursor = Math.max(cursor, c.fim)
  }
  considerar(cursor, alvo.fim)
  return melhor
}

/** A hachura do bloqueio (A3): risco diagonal em tokens neutros da casa —
 *  paper como base, line como risco. SEM cor de professora (bloqueio não é
 *  dela ocupada, é oferta fechada) e distinta do ghost chapado do Google.
 *  Exportada para a LEGENDA da página usar o mesmo swatch. */
export const BLOCKED_BG =
  'bg-[repeating-linear-gradient(135deg,var(--color-paper-100)_0px,var(--color-paper-100)_6px,var(--color-line)_6px,var(--color-line)_7px)]'

/** Agendada "cheia": bloco sólido na cor da professora, texto branco.
 *  `avail` nunca é "cheia": é SÓ camada de fundo (contrato do item 14.5 —
 *  sem rótulo, sem clique). Conserto de MOTOR defensivo pré-A3: quando o
 *  admin alimentar a disponibilidade, um `avail` puro não pode virar bloco.
 *  `blocked` idem (A3): camada de fundo nunca veste roupa de aula. */
function isSolid(ev: CalEvent) {
  return !ev.avail && !ev.blocked && !ev.ghost && !ev.dashed && !ev.warn && !ev.falta && !ev.dim && !ev.strike
}

// M-AG (matriz TIPO × ESTADO): a COR é sempre da professora (EIXO 1); o ESTADO
// é um SINAL ORTOGONAL — borda-esquerda + marcador — que NUNCA repinta o fundo
// (EIXO 2). A lavagem vermelha uniforme (danger/8) que apagava a cor por
// professora morreu no gêmeo: falta e "sem registro" vestem a tinta da
// professora com acentos danger/warn distintos.
function eventTone(ev: CalEvent) {
  const i = ev.color % TEACHER_FILL.length
  if (ev.avail) return `${TEACHER_TINT[i]} opacity-50 `
  if (ev.blocked) return `${BLOCKED_BG} ` // A3: bloqueio — hachura neutra, nunca cor de professora
  if (ev.ghost) return 'bg-paper-100/90 ' // ghost pessoal: neutro, sem cor de professora
  if (ev.dashed)
    // janela de remarcação na cor da professora; a CONSUMIDA (dim) fica OCA
    // (interior branco) contra a PUBLICADA (interior tingido) — sem opacidade no
    // contêiner (esmaeceria borda/texto/popover abaixo de contraste AA)
    return ev.dim
      ? `border border-dashed ${TEACHER_BORDER[i]} bg-paper-0 `
      : `border border-dashed ${TEACHER_BORDER[i]} ${TEACHER_TINT[i]} `
  if (ev.falta) return `border-l-2 border-l-danger-700 ${TEACHER_TINT[i]} ` // FALTA: acento danger sobre a tinta da professora
  if (ev.warn) return `border-l-2 border-l-warn-700 ${TEACHER_TINT[i]} ` // SEM REGISTRO: acento warn sobre a tinta da professora
  if (ev.dim) return `border-l-2 ${TEACHER_EDGE[i]} ${TEACHER_TINT[i]} `
  // cancelada/remarcada: papel neutro, mas a IDENTIDADE fica — a borda-esquerda
  // segue na cor da professora (borda `line` apagava QUEM tinha a aula). O
  // `opacity-75` do contêiner morreu (rodada 2 do Sol: derrubava horário e nome
  // a ~2,9:1); o esmaecimento agora é do TEXTO — ink-600 riscado no EventLabel,
  // que segura ≥4,5:1 sobre o paper-100.
  if (ev.strike) return `border-l-2 ${TEACHER_EDGE[i]} bg-paper-100 `
  return `${TEACHER_FILL[i]} shadow-(--shadow-card) `
}

function EventLabel({ ev, start, hideTime = false }: { ev: CalEvent; start: DateTime; hideTime?: boolean }) {
  const i = ev.color % TEACHER_FILL.length
  const solid = isSolid(ev)
  // Régua de legibilidade (AGENTS.md): horário e nome respondem à pergunta da
  // tela — são DADO, piso `text-sm`. Os marcadores ✓/✕/? seguem pequenos: são
  // marcador visual com sr-only, não texto de leitura. Cabe no bloco de 45min
  // (48px): uma linha de 14px + py-0.5 ≈ 22px, com folga.
  // Contraste MEDIDO (rodada 2 do Sol): sobre o bloco sólido o horário é
  // branco CHEIO + font-medium (white/75 reprovava AA em 3 das 5 cores de
  // professora — horário é DADO); riscada em ink-600 (ink-400 sobre paper
  // ficava ~3:1). Ghost em ink-900 (rodada 5): é DADO, e a régua §DADO do
  // AGENTS.md é literal — piso `text-sm font-medium text-ink-900`; ink-600 é
  // piso de RÓTULO, não cor semântica. Ver a razão completa no rótulo de
  // fundo do EventBlock.
  return (
    <>
      {/* lane dividida (hideTime): o horário SAI do texto visível — 37px não
          mostram "HH:mm" inteiro e dado cortado não é dado. Mas toque e
          teclado não têm hover (rodada 3 do Sol): o horário continua no NOME
          ACESSÍVEL via sr-only — o gatilho do popover passa a se chamar
          "HH:mm título" também fechado; hover segue com o title do bloco. */}
      {hideTime ? (
        <span className="sr-only">{start.toFormat('HH:mm')} </span>
      ) : (
        <>
          <span
            className={`font-mono text-sm leading-none ${
              solid ? 'font-medium text-white' : ev.dashed ? TEACHER_TEXT[i] : ev.ghost ? 'font-medium text-ink-900' : ev.strike ? 'font-medium text-ink-600' : 'text-ink-400'
            }`}
          >
            {start.toFormat('HH:mm')}
          </span>{' '}
        </>
      )}
      <span
        className={`text-sm leading-tight ${
          ev.strike
            ? 'font-medium text-ink-600 line-through'
            : ev.ghost
              ? // ghost é DADO no piso LITERAL (rodadas 3 e 5 do Sol):
                // font-medium + ink-900, igual ao bloqueio
                'font-medium text-ink-900'
              : solid
                ? 'font-semibold text-white'
                : ev.dashed
                  ? `font-medium ${TEACHER_TEXT[i]}`
                  : 'font-medium text-ink-900'
        }`}
      >
        {ev.title}
      </span>
      {/* ✓ é EXCLUSIVO de aula realizada — janela consumida (dashed+dim) não
          herda. Nome para o leitor de tela no padrão do ✕ e do ? */}
      {ev.dim && !ev.ghost && !ev.dashed && (
        <span className="ml-0.5 text-[10px] font-bold text-ok-700">
          <span aria-hidden>✓</span>
          <span className="sr-only">realizada</span>
        </span>
      )}
      {ev.falta && (
        <span className="ml-0.5 text-[10px] font-bold text-danger-700">
          <span aria-hidden>✕</span>
          <span className="sr-only">falta</span>
        </span>
      )}
      {/* badge warn (branco sobre warn-700 = 4,97:1); ? sozinho sobre o tint reprovava AA */}
      {ev.warn && (
        <span className="ml-0.5 inline-block rounded-[3px] bg-warn-700 px-1 text-[9px] font-bold leading-tight text-white">
          <span aria-hidden>?</span>
          <span className="sr-only">sem registro</span>
        </span>
      )}
    </>
  )
}

/** Fundo INERTE: pointer-events-none, sem gatilho — avail, blocked e o ghost
 *  SEM popup. É a mesma conta do `fundo` do EventBlock, nomeada no módulo
 *  porque a invariante de cobertura do TimeGrid precisa distinguir cobridor
 *  INERTE (deixa o toque atravessar → clique fantasma) de cobridor
 *  interativo (recebe ele mesmo o clique). */
function fundoInerte(ev: CalEvent): boolean {
  return Boolean(ev.avail || ev.blocked || (ev.ghost && !ev.popup))
}

/**
 * Fundo PROIBITIVO: a faixa diz que ali NÃO se oferece horário — bloqueio da
 * professora e compromisso pessoal do Google.
 *
 * `avail` NÃO entra: disponibilidade é fundo INFORMATIVO ("aqui ela atende"), e
 * publicar por cima dela é o gesto certo. A distinção nasceu no portão de
 * deploy de 29/07: as três categorias viviam no mesmo balaio `fundoInerte`, e
 * `pointer-events-none` deixava o toque numa faixa "bloqueada — férias" descer
 * para o botão de meia-hora e abrir "Publicar horário" — o sistema oferecendo
 * justamente o horário que a tela acabou de declarar indisponível.
 */
function fundoProibitivo(ev: CalEvent): boolean {
  return Boolean(ev.blocked || ev.ghost)
}

function EventBlock({ p, top, height, left, width, colH, hideLabel = false, hideTime = false, coberto = false, variante = 'unica', eventoAberto }: { p: Placed; top: number; height: number; left: string; width: string; colH: number; hideLabel?: boolean; hideTime?: boolean; coberto?: boolean; variante?: VarianteDaGrade; eventoAberto?: string }) {
  const { ev, start } = p
  // GEOMETRIA (Sol · rodadas 2 e 3 do A3). Evento de FUNDO desenha a
  // geometria VERDADEIRA: o pedaço já chega recortado à faixa exibida, e o
  // mínimo de 18px + re-prender por deslocamento (rodada 2, defeito 2)
  // colidiam retângulos de fundos curtos no pé da coluna — 20:44–20:49 e
  // 20:50–21:00 acabavam no MESMO top/height, um cobrindo o rótulo do outro
  // (rodada 3, achado d). Sem o mínimo, a colisão morre POR CONSTRUÇÃO: um
  // recorte curto vira tirinha honesta na posição civil certa (o max(…, 0) só
  // impede o respiro de −2px de inverter o retângulo de um pedaço de
  // ~1 minuto). O mínimo de 18px e o re-prender defensivo continuam valendo
  // SÓ para o PRIMEIRO PLANO (aulas e janelas com popup): com o span de horas
  // cobrindo os eventos de frente o caso é raro, mas um bloco de minutos
  // clicável não pode nem sumir nem vazar da coluna.
  // INVARIANTE DA CASA — NADA INVISÍVEL CONTINUA CLICÁVEL: `coberto`,
  // calculado no TimeGrid, rebaixa um fundo INTERATIVO inteiramente escondido
  // sob fundo opaco de pintura posterior a fundo comum: sem PopoverTrigger, com
  // pointer-events-none, como qualquer outro fundo. (A lista completa das
  // aparições desta família está no cabeçalho do TimeGrid.)
  const fundo = fundoInerte(ev) || coberto
  // PISO DE ALVO (portão de deploy 29/07, achado 8): 24px, a régua da casa —
  // 18px punha o alvo de toque abaixo do piso em aula de ~15 min. Vale só para
  // o PRIMEIRO PLANO e para fundo interativo; fundo passivo continua com a
  // geometria VERDADEIRA (decisão do A3: retângulo honesto, sem colisão).
  const h = fundo ? Math.max(height, 0) : Math.min(Math.max(height, 24), colH)
  let t = top
  if (!fundo) {
    if (t + h > colH) t = colH - h
    if (t < 0) t = 0
  }
  const style = { top: t, height: h, left, width } as const
  // quando a lane dividida esconde o horário do chip (hideTime), ele migra
  // para o title — o hover nativo não pode perder o dado que o chip calou
  const baseTitle = hideTime ? `${start.toFormat('HH:mm')} ${ev.title}` : ev.title
  const hoverTitle = ev.hoverExtra ? `${baseTitle} — ${ev.hoverExtra}` : baseTitle
  // item 14.1/14.5: camadas de FUNDO (disponibilidade e ocupada sem popover) não
  // têm rótulo grande nem roubam clique — o slot vazio embaixo continua vivo.
  // e2e 19/07 (agenda "bugada"): hideLabel cala o rótulo quando OUTRO bloco
  // cobre a zona do texto — o dado continua no title; texto sobreposto, nunca.
  // Declarado SEM mudança (Sol · rodada 2 do A3): com pointer-events-none o
  // title do rótulo calado é inalcançável por MOUSE — fica assim, porque
  // pointer-events-none é contrato (o slot vazio embaixo vive) e a fonte
  // COMPLETA dos bloqueios é o PAINEL de disponibilidade, não a grade.
  if (fundo) {
    return (
      <div
        style={style}
        title={hoverTitle}
        // SEM padding vertical no contêiner (Sol · rodada 4): com box-sizing
        // border-box o `py-0.5` punha um PISO de 4px no box renderizado —
        // abaixo de ~5,6 min o fundo media MAIS que o `height` declarado e
        // fundos contíguos curtíssimos voltavam a se sobrepor, furando a
        // "geometria verdadeira" da rodada 3. O respiro vertical migrou para
        // o <span> do rótulo, que vive dentro do overflow-hidden e por isso
        // não infla o box. O px-1.5 horizontal fica (não afeta altura).
        className={`pointer-events-none absolute overflow-hidden rounded-chip px-1.5 whitespace-nowrap ${eventTone(ev)}`}
      >
        {/* ghost é DADO (rodadas 2 e 5 do Sol): o compromisso do Google muda
            a decisão sobre o slot — rótulo no piso LITERAL da régua §DADO do
            AGENTS.md (text-sm font-medium ink-900), o MESMO do bloqueio
            abaixo. A distinção "vinculante × advisory" que segurava o ghost
            em ink-600 morreu na rodada 5: os dois são DADO, os dois ficam no
            piso de DADO; o que distingue os dois fundos é a FORMA (lavagem
            chapada × hachura), não o peso do texto. A lavagem discreta fica. */}
        {ev.ghost && !hideLabel && (
          // mono SÓ no horário; o nome vai na família de texto, ambos no piso
          // de DADO (font-medium — rodada 3 do Sol). inline-block: padding
          // vertical de inline puro não empurra o texto — o respiro do rótulo
          // (ex-py do contêiner) precisa de um box que o honre.
          <span className="inline-block py-0.5 text-sm leading-none font-medium text-ink-900">
            <span className="font-mono">{start.toFormat('HH:mm')}</span> {ev.title}
          </span>
        )}
        {/* bloqueio (A3) idem: DADO no piso literal (ink-900, o mesmo da note
            dele no PAINEL — o mesmo dado não fica em dois pisos na mesma
            tela). Sem horário no rótulo — o pedaço cobre o dia civil
            (00:00–24:00) e "00:00 bloqueada" seria ruído, não dado. */}
        {ev.blocked && !hideLabel && (
          <span className="inline-block py-0.5 text-sm leading-none font-medium text-ink-900">{ev.title}</span>
        )}
      </div>
    )
  }
  if (!ev.popup) {
    return (
      <div style={style} title={hoverTitle} className={`absolute overflow-hidden rounded-chip px-1.5 py-0.5 whitespace-nowrap ${eventTone(ev)}`}>
        {!hideLabel && <EventLabel ev={ev} start={start} hideTime={hideTime} />}
      </div>
    )
  }
  // O bloco É o gatilho (um botão de verdade: foco, Enter, Esc — o que o
  // `<details>` nunca deu). O balão vai para o portal do Radix, então o
  // empilhamento do popup deixou de ser problema do bloco; o gatilho aberto
  // ainda sobe um degrau para o anel de foco não ficar sob os vizinhos.
  //
  // A5: a abertura passa pelo `BalaoDoSlot` — a mesma peça do balão da meia-hora
  // —, porque o balão do evento ganhou as duas necessidades que ela resolve:
  // reabrir por URL (`?ev=`, volta de erro do desfecho) e NÃO abrir duas vezes na
  // semana, que desenha duas grades (o médio 3 do Sol no A4). Evento sem
  // `eventoAberto` casando cai no `BalaoSimples`, sem hook nenhum — o caminho
  // comum de todos os outros blocos da grade.
  return (
    <BalaoDoSlot
      chave={ev.id}
      aberturaPedida={eventoAberto}
      variante={variante}
      largura={LARGURA_DO_BALAO_DE_AULA}
      // nome acessível do diálogo (WCAG 4.1.2): sem ele o leitor de tela
      // anuncia só "diálogo" — horário + título identificam o evento
      rotulo={`${start.toFormat('HH:mm')} — ${ev.title}`}
      gatilho={
        <button
          type="button"
          style={style}
          title={hoverTitle}
          className={`absolute cursor-pointer overflow-hidden rounded-chip px-1.5 py-0.5 text-left whitespace-nowrap ${eventTone(ev)} data-[state=open]:z-20`}
        >
          {!hideLabel && <EventLabel ev={ev} start={start} hideTime={hideTime} />}
        </button>
      }
    >
      {ev.popup}
    </BalaoDoSlot>
  )
}

function TimeGrid({ days, events, tz, dayHref, todayISO, slotHref, slotPopup, slotAberto, eventoAberto, variante = 'unica' }: { days: DateTime[]; events: CalEvent[]; tz: string; dayHref: (d: string) => string; todayISO: string; slotHref?: (dateISO: string, timeHHmm: string) => string; slotPopup?: (dateISO: string, timeHHmm: string) => ReactNode; slotAberto?: string; eventoAberto?: string; variante?: VarianteDaGrade }) {
  const placed = events.map((e) => place(e, tz))
  // Particionamento pelo DIA DO INÍCIO (pré-existente do motor, herdado do
  // gêmeo — Sol · rodadas 3–4 do A3, declarado): evento que atravessa a
  // meia-noite perde a continuação no dia seguinte. Aulas não cruzam
  // meia-noite, mas o impacto NÃO é só o ghost raro do Google: a janela
  // `dashed` publicada não tem fim registrado e ganha fim IMPLÍCITO de 45 min
  // (place(), acima; criada sem `endsAtUtc` em src/app/admin/agenda/page.tsx)
  // — a dona publica um horário às 23:30, a grade mostra só 23:30–24:00 e os
  // 15 min de 00:00–00:15 do dia seguinte SOMEM; no celular ela lê uma oferta
  // menor do que publicou. Comportamento segue dívida pré-existente do motor,
  // roteada para a onda da professora; anotado na lápide do gêmeo.
  //
  // ⚠️ E A JANELA MENTE SOBRE A DURAÇÃO, NÃO SÓ SOBRE O DESENHO (revisão
  // independente do A4, 29/07 — médio 2; NÃO consertado aqui de propósito).
  // `reschedule_windows` não tem fim registrado, então o fim de 45 min é
  // INVENÇÃO da grade; quando o aluno CONSOME a janela, quem manda é a duração
  // da aula original (`v_duration := v_old.ends_at_utc - v_old.starts_at_utc`,
  // 20260712000100) — pode ser 60 min. Publicando às 23:30, a aula nasce
  // 23:30–00:30 e a grade nunca mostrou os 30 min do outro dia.
  // CASO OBRIGATÓRIO DO HARNESS E2E DO A9: publicar janela às 23:30, consumir
  // com uma aula de 60 min e provar o que a grade desenha nos DOIS dias civis.
  // Consertar exige o motor particionar por INTERVALO (não pelo dia do início)
  // e a janela ganhar fim — é a mesma travessia de meia-noite já roteada.
  const byDay = new Map<string, Placed[]>()
  for (const p of placed) {
    const k = p.start.toFormat('yyyy-LL-dd')
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }
  // Span de horas SÓ dos dias RENDERIZADOS: a semana-celular passa 1 dia mas
  // recebe os eventos da semana inteira — calcular sobre `placed` esticava o
  // dia mostrado por aulas dos outros 6 (ex.: 06:00 de quinta abrindo a grade
  // de terça). Conserto de MOTOR: espelhamento pendente anotado na lápide do
  // gêmeo (`src/components/CalendarGrid.tsx`, regra do fork).
  const shown = days.flatMap((d) => byDay.get(d.toFormat('yyyy-LL-dd')) ?? [])
  // Fim em minutos DO DIA (Sol · rodada 2 do A3, defeito 1): `end.hour` lia a
  // meia-noite do dia seguinte como hora 0 e a faixa parava ANTES do fim do
  // evento — o pedaço que termina à meia-noite ficava sem espaço para existir.
  // …e o span IGNORA `blocked` (Sol · rodada 3 do A3, reprovado): bloqueio de
  // dia inteiro (00:00→24:00, o caso comum de férias) esticava a coluna da
  // semana de 896px para 1536px. Bloqueio é contexto, não compromisso: quem
  // dita a faixa são os outros eventos (aulas, avail, ghost, dashed), e o
  // pedaço de bloqueio é então RECORTADO à faixa resultante pelo clamp dos
  // fundos abaixo — a hachura cobre a coluna visível inteira, honesta e
  // legível, sem deformar a grade.
  const hours = shown
    .filter((p) => !p.ev.blocked)
    .flatMap((p) => [p.start.hour, Math.ceil(minutosNoDia(p.end, p.start.startOf('day')) / 60)])
  const hStart = Math.min(7, ...(hours.length ? [Math.min(...hours)] : []))
  const hEnd = Math.max(21, ...(hours.length ? [Math.max(...hours)] : []))
  const totalH = (hEnd - hStart) * HOUR_PX
  // linha do "agora": leitura por request é intencional (Server Component)
  const now = DateTime.now().setZone(tz)
  const nowTop = (now.hour + now.minute / 60 - hStart) * HOUR_PX

  return (
    <div
      className="overflow-x-auto rounded-card border border-line-soft bg-paper-0 pb-24 shadow-(--shadow-card)"
      // A FOLGA QUE A GRADE DEVE AO BALÃO (A9, 30/07 — 1ª execução real do e2e).
      //
      // `overflow-x-auto` faz o eixo Y computar `auto` por especificação, então
      // ESTE contêiner é uma borda de recorte — e a borda dele encosta no último
      // evento do dia. O popover reserva `RODAPE_DO_POLEGAR` de fronteira de
      // colisão, e o Radix usa a MESMA medida para decidir se a âncora ainda
      // existe: âncora a menos disso de uma borda de recorte é declarada
      // escondida, e o balão nasce `visibility: hidden` (ver a lápide em
      // `kit/popover.tsx`). Resultado medido: o balão da ÚLTIMA aula do dia — o
      // bloco das 21:15 do casal — não abria em rolagem nenhuma da página.
      //
      // Quem reserva a faixa tem de encontrá-la: a grade oferece exatamente a
      // folga que o balão pede — `pb-24` são os mesmos 96px do `RODAPE_DO_POLEGAR`.
      // ⚠️ O número é ESCRITO aqui, não importado: `kit/popover.tsx` é
      // 'use client' e este arquivo é Server Component — constante que atravessa
      // essa fronteira chega como REFERÊNCIA, não como valor (medido no A9; a
      // lápide está em `src/lib/kit/balao.ts`). Os dois números ficam amarrados
      // por asserção no portão (`tests/portao-deploy-agenda.test.ts` §6).
    >
      <div className={days.length > 1 ? 'min-w-[640px]' : ''}>
        {/* cabeçalho dos dias — em dia único no celular a faixa de dias acima
            já mostra a seleção; o cabeçalho duplicado some. Régua medida:
            weekday e número em 14px na tinta forte; hoje = círculo da marca. */}
        <div
          className={`${days.length === 1 ? 'hidden sm:grid' : 'grid'} border-b border-line`}
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}
        >
          <div />
          {days.map((d) => {
            const iso = d.toFormat('yyyy-LL-dd')
            const today = iso === todayISO
            return (
              <Link key={iso} href={dayHref(iso)} className="flex items-baseline justify-center gap-1.5 px-1 py-2 transition-colors hover:bg-paper-100" title="Abrir o dia">
                <span className="text-sm tracking-wide text-ink-900 uppercase">{WEEKDAYS_SHORT[d.weekday - 1]}</span>
                <span
                  className={`text-sm font-semibold ${today ? 'flex h-8 w-8 items-center justify-center rounded-full bg-ac-deep text-white' : 'text-ink-900'}`}
                >
                  {d.day}
                </span>
              </Link>
            )
          })}
        </div>
        {/* corpo com linhas de hora */}
        <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}>
          <div className="relative" style={{ height: totalH }}>
            {/* eixo de horas é APOIO na régua (todo evento carrega o próprio
                horário no chip): `text-xs ink-400` é o piso DE APOIO declarado,
                não rebaixamento de dado */}
            {Array.from({ length: hEnd - hStart }, (_, i) => (
              <span key={i} className="absolute right-2 -translate-y-1/2 font-mono text-xs text-ink-400" style={{ top: i * HOUR_PX }}>
                {i === 0 ? '' : `${String(hStart + i).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const iso = d.toFormat('yyyy-LL-dd')
            const dayEvents = byDay.get(iso) ?? []
            // item 14.1 (modelo Google): disponibilidade/ocupada/janela são
            // CAMADAS DE FUNDO em largura total — só os eventos de frente
            // (aulas) disputam lanes. Mata o "duas pessoas no mesmo horário"
            // falso e os nomes cortados.
            const bgEvents = dayEvents.filter((p) => p.ev.avail || p.ev.blocked || p.ev.ghost || p.ev.dashed)
            const fgEvents = dayEvents.filter((p) => !(p.ev.avail || p.ev.blocked || p.ev.ghost || p.ev.dashed))
            const pos = lanes(fgEvents)
            // prioridade das camadas de FUNDO: janela tracejada > bloqueio (A3)
            // > ghost > disponibilidade — quem carrega o rótulo mais decisivo
            // fica por cima e cala o de baixo.
            const bgPriority = (p: Placed) => (p.ev.dashed ? 3 : p.ev.blocked ? 2 : p.ev.ghost ? 1 : 0)
            // ORDEM DE PINTURA por prioridade CRESCENTE (Sol · rodada 1 do A3,
            // item 3 — grave): pintar na ordem de chegada deixava a hachura
            // opaca do bloqueio COBRIR a janela tracejada, que continuava
            // clicável embaixo (a hachura é pointer-events-none) — um botão
            // invisível. O maior pinta POR ÚLTIMO/acima; sort estável preserva
            // a ordem de chegada entre iguais (é ela que decide o muting).
            const bgOrdenados = [...bgEvents].sort((a, b) => bgPriority(a) - bgPriority(b))
            const ordemDePintura = new Map(bgOrdenados.map((p, i) => [p.ev.id, i]))
            // e2e 19/07 (texto sobreposto): o rótulo mora no TOPO do bloco;
            // se um bloco da frente — ou um fundo pintado ACIMA (prioridade
            // maior, ou IGUAL pintado depois: dois bloqueios no mesmo horário
            // sobrepunham rótulos ilegíveis — Sol · A3 item 6) — cobre essa
            // zona (~20 min), o fundo fica mudo (title preserva o dado).
            const LABEL_ZONE_MS = 20 * 60_000
            const coversLabel = (other: Placed, of: Placed) =>
              other.start.toMillis() < of.start.toMillis() + LABEL_ZONE_MS &&
              other.end.toMillis() > of.start.toMillis()
            const bgMuted = new Map(
              bgEvents.map((p) => [
                p.ev.id,
                fgEvents.some((f) => coversLabel(f, p)) ||
                  bgEvents.some(
                    (o) =>
                      o !== p &&
                      ordemDePintura.get(o.ev.id)! > ordemDePintura.get(p.ev.id)! &&
                      coversLabel(o, p),
                  ),
              ]),
            )
            const today = iso === todayISO
            const meiaNoite = d.startOf('day')
            const emMinutos = (p: Placed): Faixa => ({
              ini: minutosNoDia(p.start, meiaNoite),
              fim: minutosNoDia(p.end, meiaNoite),
            })
            // INVARIANTE DA CASA: NADA INVISÍVEL CONTINUA CLICÁVEL — a QUARTA
            // aparição desta família, contadas todas:
            //   1. A3 · rodada 1 — hachura do bloqueio pintada SOBRE a janela
            //      `dashed`, que continuava clicável embaixo (ordem de pintura);
            //   2. 28/07, hotfix iOS — `.linha-ancora` da DataTable: a capa
            //      esticada engolia todos os toques no Safari;
            //   3. A3 · rodada 5 — hachura sobre o ghost COM popup: férias
            //      escondiam o compromisso do Google e o toque na área
            //      "bloqueada" abria, do nada, o popover dele;
            //   4. portão de deploy 29/07 — PROIBIÇÃO × SLOT: a mesma hachura
            //      (e a lavagem do ghost) por cima do botão de meia-hora, que
            //      seguia vivo e abria "Publicar horário" no horário que a tela
            //      declarava indisponível. É o defeito de 1 e 3 um degrau abaixo:
            //      lá o cobridor escondia outro FUNDO, aqui esconde o SLOT.
            // O remédio é sempre o mesmo: quem pinta por cima responde pelo
            // toque — ou o de baixo deixa de ser gatilho, ou encolhe para o que
            // continua à vista.
            //
            // Para o SLOT a régua é por CATEGORIA, não por cobertura: fundo
            // PROIBITIVO (bloqueio, ocupada) mata a oferta daquela meia-hora;
            // `avail` é informativo e não mata nada.
            const proibicoes = dayEvents
              .filter((p) => fundoProibitivo(p.ev))
              .map((p) => ({ faixa: emMinutos(p), motivo: p.ev.title }))
            const proibicaoDoSlot = (iniMin: number) =>
              proibicoes.find((b) => seSobrepoem(b.faixa, { ini: iniMin, fim: iniMin + 30 }))
            // A4 · médio 2 — REABRIR NÃO É O MESMO QUE CLICAR. As proibições
            // acima matam o gatilho (o dedo nunca chega lá), mas uma AULA ou uma
            // janela tracejada cobrem o slot só VISUALMENTE: elas ficam por cima
            // e recebem o clique, e a meia-hora continua embaixo. Uma URL de
            // erro guardada (ou um Back) pedia a abertura de um slot que, entre
            // um momento e outro, ganhou aula — e o balão nascia POR BAIXO do
            // bloco, oferecendo "criar aqui" onde já há compromisso. Abertura
            // automática só em slot que continua VAZIO; o clique deliberado da
            // dona segue possível (é o comportamento de sempre da grade).
            const ocupacoes = dayEvents
              .filter((p) => !p.ev.avail && !fundoProibitivo(p.ev))
              .map((p) => emMinutos(p))
            const slotOcupado = (iniMin: number) =>
              ocupacoes.some((f) => seSobrepoem(f, { ini: iniMin, fim: iniMin + 30 }))
            // …e para o FUNDO INTERATIVO a régua é a sobreposição real com os
            // cobridores INERTES pintados acima (um cobridor interativo — aula,
            // `dashed` — recebe ele mesmo o clique; não há toque fantasma).
            const cobridoresInertes = (p: Placed): Faixa[] =>
              bgEvents
                .filter(
                  (o) =>
                    o !== p &&
                    fundoInerte(o.ev) &&
                    ordemDePintura.get(o.ev.id)! > ordemDePintura.get(p.ev.id)!,
                )
                .map(emMinutos)
            return (
              <div key={iso} className={`relative border-l border-line-soft ${today ? 'bg-paper-100/50' : ''}`} style={{ height: totalH }}>
                {Array.from({ length: hEnd - hStart }, (_, i) => (
                  <div key={i} className="absolute right-0 left-0 border-t border-line-soft" style={{ top: i * HOUR_PX }} />
                ))}
                {today && nowTop > 0 && nowTop < totalH && (
                  <div className="absolute right-0 left-0 z-10 border-t-2 border-danger-700" style={{ top: nowTop }}>
                    <span className="absolute -top-[4px] -left-[3px] h-1.5 w-1.5 rounded-full bg-danger-700" />
                  </div>
                )}
                {/* meias-horas vazias clicáveis (atrás dos eventos): "+ HH:mm"
                    aparece no hover, como no Google Agenda.
                    `tabIndex={-1}`: as meias-horas são superfície de PONTEIRO
                    (como no Google) — 28 gatilhos × 7 dias hidratados viravam
                    parede de Tab antes de qualquer evento. O caminho de TECLADO
                    para criar/publicar é a toolbar `[+ Nova aula ▾]` (decisão
                    registrada no goal da onda; o e2e do A9 confere). Gatilhos
                    de EVENTO continuam tabáveis. */}
                {(slotPopup || slotHref) &&
                  Array.from({ length: (hEnd - hStart) * 2 }, (_, i) => {
                    const hh = String(hStart + Math.floor(i / 2)).padStart(2, '0')
                    const mm = i % 2 === 0 ? '00' : '30'
                    const top = i * (HOUR_PX / 2)
                    // FAIXA PROIBITIVA NÃO OFERECE HORÁRIO (ver a invariante
                    // acima). A decisão entre "não renderiza" e "renderiza
                    // desabilitado": fica um retângulo INERTE, sem gatilho —
                    // ele é quem RECEBE o toque (e o toque não faz nada), em
                    // vez de deixar a área muda e o dedo cair sabe-se lá onde.
                    // Bônus: o motivo vive no `title` deste retângulo, que é
                    // alcançável pelo mouse — o do fundo não é
                    // (pointer-events-none, residual declarado no A3).
                    const proibido = proibicaoDoSlot(
                      (hStart + Math.floor(i / 2)) * 60 + (i % 2) * 30,
                    )
                    if (proibido)
                      return (
                        <div
                          key={`slot-${i}`}
                          className="absolute right-0 left-0 z-0"
                          style={{ top, height: HOUR_PX / 2 }}
                          title={`${hh}:${mm} — indisponível (${proibido.motivo})`}
                        />
                      )
                    // item 14.3 (quick-create): o clique abre o mini-form ALI,
                    // sem reload — Popover do kit ancorado na própria meia-hora.
                    // O flip para cima nas últimas linhas deixou de ser conta
                    // manual: a colisão é do Radix.
                    if (slotPopup)
                      return (
                        // A4: o balão pode nascer ABERTO — é assim que a volta
                        // de erro devolve a dona ao horário que ela tocou, em
                        // vez de fechar tudo e apagar o que ela digitou. Quem
                        // governa a abertura é o `BalaoDoSlot` (estado no
                        // cliente, derivado da URL e da grade visível): o
                        // `defaultOpen` do Radix abria as DUAS grades da semana
                        // e não reagia a Back/Forward.
                        <BalaoDoSlot
                          key={`slot-${i}`}
                          chave={`${iso}T${hh}:${mm}`}
                          aberturaPedida={
                            slotOcupado((hStart + Math.floor(i / 2)) * 60 + (i % 2) * 30)
                              ? undefined
                              : slotAberto
                          }
                          variante={variante}
                          rotulo={`Ações do horário ${hh}:${mm} de ${d.setLocale('pt-BR').toFormat('cccc dd/LL')}`}
                          gatilho={
                            /* aberto sobe um degrau de z: o rótulo "＋ HH:mm"
                               aceso não pode ficar sob os blocos vizinhos */
                            <button
                              type="button"
                              tabIndex={-1}
                              className="group absolute right-0 left-0 z-0 cursor-pointer data-[state=open]:z-20"
                              style={{ top, height: HOUR_PX / 2 }}
                              // A4: o balão deixou de ser só "publicar horário"
                              // (são TRÊS intenções agora) — o hover nativo não
                              // pode continuar prometendo uma delas.
                              title={`Criar às ${hh}:${mm}`}
                            >
                              {/* HOVER SÓ ONDE HOVER EXISTE (portão de deploy
                                  29/07, achado 9): no Safari do iPhone o
                                  `:hover` GRUDA depois do toque, e a meia-hora
                                  ficava com o "＋ HH:mm" aceso, parecendo
                                  selecionada. A media query de ponteiro fino
                                  desliga o realce no toque; o estado ABERTO
                                  (data-state) segue valendo em qualquer
                                  ponteiro, que é o realce que importa lá.

                                  ⚠️ O SUBLINHADO É SINTAXE, não estilo: em
                                  variante arbitrária do Tailwind o `_` vira
                                  ESPAÇO. Escrito `(hover:hover)and(pointer:fine)`
                                  — sem os sublinhados — a media query sai
                                  inválida, e o `next dev` derruba a tela (o
                                  build de produção tolera e o defeito só
                                  aparece na máquina de quem desenvolve).
                                  Corrigido no A6/lote 2. */}
                              <span className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-chip bg-paper-100 text-sm font-semibold text-ac-deep [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex group-data-[state=open]:flex">
                                ＋ {hh}:{mm}
                              </span>
                            </button>
                          }
                        >
                          {slotPopup(iso, `${hh}:${mm}`)}
                        </BalaoDoSlot>
                      )
                    return (
                      <Link
                        key={`slot-${i}`}
                        href={slotHref!(iso, `${hh}:${mm}`)}
                        tabIndex={-1}
                        className="group absolute right-0 left-0 z-0"
                        style={{ top, height: HOUR_PX / 2 }}
                        title={`Publicar janela ${hh}:${mm}`}
                      >
                        {/* mesma régua de ponteiro do ramo com popover */}
                        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-chip bg-paper-100 text-sm font-semibold text-ac-deep [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex">
                          ＋ {hh}:{mm}
                        </span>
                      </Link>
                    )
                  })}
                {bgOrdenados.map((p) => {
                  // CLAMP à faixa de horas exibida (Sol · rodada 1 do A3, item
                  // 2 — grave): um bloqueio de dia inteiro (00:00 → meia-noite
                  // seguinte) media 24h de altura numa grade que só desenha
                  // hStart–hEnd — a coluna deformava. O fundo é contexto: o
                  // desenho fica preso ao que a grade mostra; fora da faixa,
                  // nada a desenhar. A conta é em MINUTOS DESDE A MEIA-NOITE
                  // do dia de exibição (rodada 2, defeito 1): fim à meia-noite
                  // do dia seguinte = 1440 min = fundo até o pé da coluna —
                  // `end.hour` lia 0 e o pedaço sáb 22:00→24:00 colapsava.
                  const iniMin = Math.max(minutosNoDia(p.start, meiaNoite), hStart * 60)
                  const fimMin = Math.min(minutosNoDia(p.end, meiaNoite), hEnd * 60)
                  if (fimMin <= iniMin) return null
                  // Fundo INTERATIVO (hoje: ghost com popup) encolhe para o
                  // maior trecho que os fundos inertes pintados acima deixam à
                  // vista, e só perde o gatilho quando não sobra nada
                  // (`trechoVisivel`). Fundo passivo desenha a geometria
                  // verdadeira, intocada.
                  const visivel = fundoInerte(p.ev)
                    ? { ini: iniMin, fim: fimMin }
                    : trechoVisivel({ ini: iniMin, fim: fimMin }, cobridoresInertes(p))
                  const faixa = visivel ?? { ini: iniMin, fim: fimMin }
                  const top = ((faixa.ini - hStart * 60) / 60) * HOUR_PX
                  const height = ((faixa.fim - faixa.ini) / 60) * HOUR_PX - 2
                  return (
                    <EventBlock key={p.ev.id} p={p} top={top} height={height} left="2px" width="calc(100% - 4px)" colH={totalH} hideLabel={bgMuted.get(p.ev.id)} coberto={visivel === null} variante={variante} eventoAberto={eventoAberto} />
                  )
                })}
                {fgEvents.map((p) => {
                  const { lane, of } = pos.get(p.ev.id) ?? { lane: 0, of: 1 }
                  const top = (p.start.hour + p.start.minute / 60 - hStart) * HOUR_PX
                  // piso de ALVO: 24px, a régua da casa (achado 8 do portão)
                  const height = Math.max(p.end.diff(p.start, 'hours').hours * HOUR_PX - 2, 24)
                  const width = `calc(${100 / of}% - 4px)`
                  const left = `calc(${(100 / of) * lane}% + 2px)`
                  // lane dividida: o chip mostra só o nome (hideTime) — o
                  // horário completo segue no title/aria-label/popover
                  return <EventBlock key={p.ev.id} p={p} top={top} height={height} left={left} width={width} colH={totalH} hideTime={of > 1} variante={variante} eventoAberto={eventoAberto} />
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Faixa de dias do celular: bolinhas por professora, cada dia navega. */
function DayStrip({ weekDays, events, tz, dayHref, todayISO, selectedISO }: { weekDays: DateTime[]; events: CalEvent[]; tz: string; dayHref: (d: string) => string; todayISO: string; selectedISO: string }) {
  const colorsByDay = new Map<string, Set<number>>()
  for (const ev of events) {
    // camadas de fundo não viram bolinha: a faixa resume AULAS por professora
    // (`avail` e `blocked` incluídos no pulo — são contexto, contrato do 14.5/A3)
    if (ev.dashed || ev.ghost || ev.avail || ev.blocked) continue
    const iso = DateTime.fromISO(ev.startsAtUtc).setZone(tz).toFormat('yyyy-LL-dd')
    const set = colorsByDay.get(iso) ?? new Set<number>()
    set.add(ev.color % TEACHER_FILL.length)
    colorsByDay.set(iso, set)
  }
  return (
    <div className="flex items-stretch gap-1 rounded-card border border-line-soft bg-paper-0 p-1.5 shadow-(--shadow-card) sm:hidden">
      {weekDays.map((d) => {
        const iso = d.toFormat('yyyy-LL-dd')
        const today = iso === todayISO
        const selected = iso === selectedISO
        const colors = [...(colorsByDay.get(iso) ?? [])]
        return (
          <Link
            key={iso}
            href={dayHref(iso)}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-chip py-1.5 ${selected ? 'bg-paper-100' : ''}`}
          >
            {/* weekday no piso de RÓTULO da régua (text-sm ink-600). Cabe nas
                7 colunas em 375px: 375 − 32 (px-4 do shell) − 2 (borda) − 12
                (p-1.5) − 24 (6 gaps de 4px) = 305px → ~43px por coluna, contra
                ~31px do rótulo de 3 letras em 14px. */}
            <span className="text-sm tracking-wide text-ink-600 uppercase">{WEEKDAYS_SHORT[d.weekday - 1]}</span>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                today ? 'bg-ac-deep text-white' : selected ? 'text-ink-900' : 'text-ink-600'
              }`}
            >
              {d.day}
            </span>
            {/* bolinhas DECORATIVAS (aria-hidden): a informação completa está
                na grade do dia — para o leitor de tela elas eram só ruído */}
            <span aria-hidden className="flex h-1.5 items-center gap-0.5">
              {colors.slice(0, 4).map((c) => (
                <span key={c} className={`h-1.5 w-1.5 rounded-full ${TEACHER_FILL[c]}`} />
              ))}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function MonthGrid({ anchor, events, tz, dayHref, todayISO, eventoAberto }: { anchor: DateTime; events: CalEvent[]; tz: string; dayHref: (d: string) => string; todayISO: string; eventoAberto?: string }) {
  const monthStart = anchor.startOf('month')
  const gridStart = monthStart.minus({ days: monthStart.weekday - 1 }) // segunda (item 14.2)
  const days = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }))
  const placed = events.map((e) => place(e, tz))
  const byDay = new Map<string, Placed[]>()
  for (const p of placed) {
    const k = p.start.toFormat('yyyy-LL-dd')
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }

  return (
    <div
      className="overflow-x-auto rounded-card border border-line-soft bg-paper-0 pb-24 shadow-(--shadow-card)"
      // A mesma folga da grade de horas, pela mesma razão: os eventos da última
      // semana do mês encostam no pé deste contêiner, que também é borda de
      // recorte. Ver a lápide longa no `TimeGrid` acima.
    >
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS_SHORT.map((w) => (
            <span key={w} className="px-2 py-2 text-center text-sm tracking-wide text-ink-900 uppercase">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const iso = d.toFormat('yyyy-LL-dd')
            const inMonth = d.month === anchor.month
            const today = iso === todayISO
            // `avail` e `blocked` são SÓ camada de fundo, e o mês não tem
            // camada de fundo — não viram chip nem inflam o "+N mais".
            // (avail: conserto defensivo pré-A3; blocked: contrato do A3.)
            const dayEvents = (byDay.get(iso) ?? [])
              .filter((p) => !p.ev.avail && !p.ev.blocked)
              .sort((a, b) => a.start.toMillis() - b.start.toMillis())
            const extra = dayEvents.length - 3
            return (
              <div
                key={iso}
                className={`min-h-[133px] border-b border-l border-line-soft p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${today ? 'bg-paper-100/50' : ''}`}
              >
                {/* data fora do mês em ink-600 (ink-400/60 media 2,4:1 — data
                    é DADO); a diferenciação com o mês corrente segue pelo
                    PESO: dentro ink-900 semibold, fora ink-600 normal */}
                <Link
                  href={dayHref(iso)}
                  className={`float-right flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors hover:bg-paper-100 ${
                    today ? 'bg-ac-deep font-semibold text-white hover:bg-ac-deep' : inMonth ? 'font-semibold text-ink-900' : 'text-ink-600'
                  }`}
                  title="Abrir o dia"
                >
                  {d.day}
                </Link>
                <div className="clear-both flex flex-col gap-0.5 pt-8">
                  {dayEvents.slice(0, 3).map((p) => {
                    if (!p.ev.popup)
                      return (
                        <div key={p.ev.id} className={`truncate rounded-chip px-1.5 py-0.5 ${eventTone(p.ev)}`}>
                          <EventLabel ev={p.ev} start={p.start} />
                        </div>
                      )
                    return (
                      // A5: a MESMA peça de abertura controlada da grade de horas
                      // (`?ev=` reabre o balão na volta de erro). Aqui a variante
                      // é sempre `unica` — o mês desenha UMA grade, então não há o
                      // par de balões da semana.
                      <BalaoDoSlot
                        key={p.ev.id}
                        chave={p.ev.id}
                        aberturaPedida={eventoAberto}
                        variante="unica"
                        largura={LARGURA_DO_BALAO_DE_AULA}
                        rotulo={`${p.start.toFormat('HH:mm')} — ${p.ev.title}`}
                        gatilho={
                          <button
                            type="button"
                            className={`cursor-pointer truncate rounded-chip px-1.5 py-0.5 text-left ${eventTone(p.ev)}`}
                          >
                            <EventLabel ev={p.ev} start={p.start} />
                          </button>
                        }
                      >
                        {p.ev.popup}
                      </BalaoDoSlot>
                    )
                  })}
                  {extra > 0 && (
                    // "+N mais" é AÇÃO (navega para o dia) e AÇÃO em tela nova
                    // não pode ser link textual puro: chip com alvo ≥24px
                    // (min-h-6) e affordance de hover no padrão do kit
                    <Link
                      href={dayHref(iso)}
                      className="inline-flex min-h-6 items-center rounded-chip px-1.5 text-sm font-semibold text-ac-deep hover:bg-paper-100"
                    >
                      +{extra} mais
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function Calendario({ events, view, anchor, tz, dayHref, todayISO, slotHref, slotPopup, slotAberto, eventoAberto }: Props) {
  const a = DateTime.fromISO(anchor, { zone: tz })
  if (view === 'mes') return <MonthGrid anchor={a} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} eventoAberto={eventoAberto} />
  const weekDays = Array.from({ length: 7 }, (_, i) => a.startOf('day').minus({ days: a.weekday - 1 }).plus({ days: i }))
  const days = view === 'dia' ? [a.startOf('day')] : weekDays
  return (
    <div className="flex flex-col gap-2">
      <DayStrip weekDays={weekDays} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} selectedISO={a.toFormat('yyyy-LL-dd')} />
      {/* Semana no celular: 7 colunas espremidas não dá — mostra o dia
          selecionado; a faixa acima navega. Desktop mantém as 7 colunas.
          O `slotAberto` viaja para as DUAS cópias — mas quem ABRE é uma só.
          A primeira versão deixava as duas abrirem "porque o servidor não sabe
          o tamanho da tela", e com isso a semana montava DOIS balões abertos
          quando o slot do erro caía no dia da âncora: o da grade escondida vira
          conteúdo órfão que o `hideWhenDetached` apenas ESCONDE (não desmonta),
          come o primeiro `Esc` e disputa o foco. A decisão de media query passou
          para o cliente, DEPOIS de montar (`kit/balao-do-slot.tsx`, médio 3 do
          Sol) — cada grade se identifica pela `variante`. */}
      {view === 'semana' && (
        <div className="sm:hidden">
          <TimeGrid days={[a.startOf('day')]} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} slotHref={slotHref} slotPopup={slotPopup} slotAberto={slotAberto} eventoAberto={eventoAberto} variante="movel" />
        </div>
      )}
      <div className={`${view === 'semana' ? 'hidden sm:block' : ''} ${view === 'dia' ? 'max-w-3xl' : ''}`}>
        <TimeGrid days={days} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} slotHref={slotHref} slotPopup={slotPopup} slotAberto={slotAberto} eventoAberto={eventoAberto} variante={view === 'semana' ? 'desktop' : 'unica'} />
      </div>
    </div>
  )
}
