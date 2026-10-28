// ⚰️ LÁPIDE (Onda da Agenda · A2): este arquivo serve SÓ o painel da
// professora (`/teacher`), até a onda dela. O admin usa o gêmeo
// `src/components/kit/calendario.tsx` — mesmo motor, pele da régua medida do
// TutorBird e popups no Popover do kit (os `<details data-popup>` daqui são
// legado tolerado apenas em tela velha).
//
// ⚠️ REGRA DO FORK (risco 3 do goal `docs/goals/onda-agenda.md`): qualquer
// conserto de MOTOR feito no gêmeo (lanes, particionamento por dia, camadas de
// fundo, muting de rótulo, span de horas) precisa ser ESPELHADO aqui — ou, no
// mínimo, anotado neste cabeçalho para a onda da professora. Senão o bug morre
// no admin e ressuscita no painel dela.
//
// ⏳ Conserto já feito no gêmeo do kit e PENDENTE aqui: span de horas por dia
// RENDERIZADO. `hStart`/`hEnd` abaixo consideram TODOS os eventos recebidos;
// numa visão de 1 dia que recebe a semana inteira, o dia mostrado estica por
// eventos dos outros 6 (no kit o span é calculado só sobre os dias em `days`,
// depois da partição `byDay`).
//
// ⏳ Conserto 2 (rodada 2 do Sol no A2), também PENDENTE aqui: `avail` é SÓ
// camada de fundo (contrato do item 14.5 — sem rótulo, sem clique). No kit ela
// é excluída dos chips do mês e da conta do "+N mais", das bolinhas do
// DayStrip e do `isSolid()`. Aqui um evento `avail` puro ainda viraria
// chip/bolinha/bloco sólido se alguém alimentar a camada neste componente.
//
// ⏳ Consertos 3–7 (Sol · rodadas 1–5 do A3 no gêmeo), TODOS de motor e
// PENDENTES aqui — a onda da professora espelha:
//   3. Clamp CIVIL dos fundos à faixa de horas exibida, com fim à meia-noite
//      tratado como minuto 1440 do dia — NUNCA "hora 0" (`end.hour` fazia o
//      pedaço que termina 24:00 colapsar no clamp e sumir da grade); no kit é
//      a `minutosNoDia()` presa a [0, 1440].
//   4. Fundo passivo (avail/blocked/ghost sem popup) desenha a geometria
//      VERDADEIRA: sem mínimo de 18px, sem deslocamento de top (o mínimo +
//      re-prender colidiam retângulos de fundos curtos no pé da coluna) e
//      SEM padding vertical no CONTÊINER — com box-sizing border-box o
//      `py-0.5` punha um PISO físico de 4px no box renderizado e fundos
//      contíguos curtíssimos voltavam a se sobrepor; o respiro mora no
//      RÓTULO (span `inline-block`, que vive no overflow-hidden e não infla
//      o box). O mínimo + re-prender ficam SÓ no primeiro plano (aulas e
//      janelas clicáveis).
//   5. Pintura dos fundos por `bgPriority` com ordem ESTÁVEL (crescente,
//      maior por último/acima): sem isso a hachura de bloqueio cobre janela
//      `dashed` CLICÁVEL — botão invisível sob camada pointer-events-none.
//   6. Muting de rótulo entre fundos de MESMA prioridade segue a ORDEM DE
//      PINTURA (senão dois bloqueios no mesmo horário sobrepõem rótulos).
//   7. INVARIANTE — NADA INVISÍVEL CONTINUA CLICÁVEL (3ª aparição da mesma
//      família na onda: rodada 1 do A3, hachura sobre janela `dashed`;
//      hotfix iOS de 28/07, `.linha-ancora`; rodada 5 do A3, hachura sobre
//      ghost-com-popup): fundo INTERATIVO (ghost com popup) coberto por
//      fundo OPACO de pintura posterior perde o GATILHO — rebaixado a fundo
//      inerte (sem trigger, pointer-events-none), pela MESMA conta de
//      cobertura do muting de rótulo, restrita a cobridor INERTE (cobridor
//      interativo recebe ele mesmo o clique). Aqui o popup ainda é
//      `<details>`; espelhar o rebaixamento quando este painel ganhar as
//      camadas de fundo.
//
// ⏳ Consertos 8–11 (PORTÃO DE DEPLOY de 29/07 no gêmeo), PENDENTES aqui:
//   8. QUARTA aparição da família do item 7, um degrau abaixo: fundo
//      PROIBITIVO (bloqueio da professora e `ghost` de ocupação) por cima do
//      botão de meia-hora, que seguia VIVO — o toque na faixa que diz
//      "bloqueada"/"ocupada" abria o formulário de publicar horário. Este
//      painel TEM `ghost` e TEM meia-hora clicável, então o defeito existe
//      aqui hoje (só não há bloqueio, que é sinal do fork). No gêmeo a régua
//      é por CATEGORIA: `avail` é informativo (o slot embaixo vive) e
//      proibição não renderiza gatilho — no lugar, um retângulo inerte com o
//      motivo no `title`.
//   9. Cobertura do fundo interativo por SOBREPOSIÇÃO REAL de intervalo (não
//      pela zona de rótulo de 20 min): o gatilho encolhe para o maior trecho
//      visível e só morre quando não sobra nada. A conta por zona de rótulo
//      errava nos dois sentidos em sobreposição parcial.
//  10. Piso de ALVO de 24px (a régua da casa) para elemento INTERATIVO — aqui
//      ainda é 18px, e em três lugares (o `Math.max(height, 18)` do
//      EventBlock e os dois `Math.max(..., 18)` das lanes).
//  11. Hover da meia-hora atrás de `(hover:hover) and (pointer:fine)`: no
//      Safari do iPhone o `:hover` gruda depois do toque e o "＋ HH:mm" fica
//      aceso, parecendo seleção. Aqui os dois `group-hover:flex` continuam
//      desprotegidos.
//
// ⏳ Notas declaradas (Sol · rodadas 3–4 do A3 no gêmeo — o motor daqui
// herda as duas): (a) o particionamento pelo DIA DO INÍCIO perde a
// continuação de evento que atravessa a meia-noite — aulas não cruzam, mas o
// impacto não é só o raro ghost do Google que cruza (perde a sobra): a janela
// `dashed` publicada não tem fim registrado e ganha fim IMPLÍCITO de 45 min
// (`place()`), então uma janela publicada às 23:30 desenha só 23:30–24:00 e
// os 15 min de 00:00–00:15 do dia seguinte SOMEM — no celular a dona lê uma
// oferta menor do que publicou; (b) fundo DEGENERADO na hora repetida do
// fall-back: um pedaço real 01:30 EDT → 01:30 EST colapsa no MESMO minuto
// civil e o clamp descarta — fora do horizonte operacional no admin (não
// "inalcançável": Cuiabá tem fall-back histórico no tzdata, fev/2019, e a URL
// navega para trás), e este painel exibirá no fuso DA PROFESSORA (F3-D2):
// tratar na onda dela, junto do quirk da hora repetida já roteado pelo A2.
//
// Grade de calendário — referência Google Agenda, superfície "Papel & Tinta".
// Server-first e CSS-only: visões são links, popup de evento é <details> —
// zero JavaScript de cliente. LEITURA + ações de 1 clique; arrastar-para-
// remarcar é regra de banco (crédito/alçada — fica fora por decisão).
//
// Lei 1: Luxon SÓ formata/particiona para exibição — os instantes chegam em UTC.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { DateTime } from 'luxon'
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
  /** fuso de exibição (negócio no admin; da professora no /teacher) */
  tz: string
  /** monta o link da visão-dia de uma data */
  dayHref: (dateISO: string) => string
  /** 'yyyy-LL-dd' de hoje no fuso de exibição */
  todayISO: string
  /** meia-hora VAZIA vira link (ex.: publicar janela ali) — semana/dia */
  slotHref?: (dateISO: string, timeHHmm: string) => string
  /** item 14.3 (quick-create do Google): meia-hora vazia abre POPUP no local
   *  com o mini-form pronto (data/hora já embutidas) — sem reload, sem viajar
   *  para o formulário do topo. Quando presente, substitui o slotHref. */
  slotPopup?: (dateISO: string, timeHHmm: string) => ReactNode
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

/** Agendada "cheia": bloco sólido na cor da professora, texto branco. */
function isSolid(ev: CalEvent) {
  return !ev.ghost && !ev.dashed && !ev.warn && !ev.falta && !ev.dim && !ev.strike
}

// M-AG (matriz TIPO × ESTADO): a COR é sempre da professora (EIXO 1); o ESTADO
// é um SINAL ORTOGONAL — borda-esquerda + marcador — que NUNCA repinta o fundo
// (EIXO 2). A lavagem vermelha uniforme (danger/8) que apagava a cor por
// professora morreu aqui: falta e "sem registro" agora vestem a tinta da
// professora com acentos danger/warn distintos.
function eventTone(ev: CalEvent) {
  const i = ev.color % TEACHER_FILL.length
  if (ev.avail) return `${TEACHER_TINT[i]} opacity-50 `
  if (ev.ghost) return 'bg-paper-100/90 ' // ghost pessoal: neutro, sem cor de professora
  if (ev.dashed)
    // janela de remarcação na cor da professora; a CONSUMIDA (dim) fica OCA
    // (interior branco) contra a PUBLICADA (interior tingido) — sem opacidade no
    // contêiner (esmaeceria borda/texto/popup abaixo de contraste AA)
    return ev.dim
      ? `border border-dashed ${TEACHER_BORDER[i]} bg-paper-0 `
      : `border border-dashed ${TEACHER_BORDER[i]} ${TEACHER_TINT[i]} `
  if (ev.falta) return `border-l-2 border-l-danger-700 ${TEACHER_TINT[i]} ` // FALTA: acento danger sobre a tinta da professora
  if (ev.warn) return `border-l-2 border-l-warn-700 ${TEACHER_TINT[i]} ` // SEM REGISTRO: acento warn sobre a tinta da professora
  if (ev.dim) return `border-l-2 ${TEACHER_EDGE[i]} ${TEACHER_TINT[i]} `
  if (ev.strike) return 'border-l-2 border-l-line bg-paper-100 opacity-75 '
  return `${TEACHER_FILL[i]} shadow-(--shadow-card) `
}

function EventLabel({ ev, start }: { ev: CalEvent; start: DateTime }) {
  const i = ev.color % TEACHER_FILL.length
  const solid = isSolid(ev)
  return (
    <>
      <span className={`font-mono text-[10px] leading-none ${solid ? 'text-white/75' : ev.dashed ? TEACHER_TEXT[i] : 'text-ink-400'}`}>
        {start.toFormat('HH:mm')}
      </span>{' '}
      <span
        className={`text-[11px] leading-tight ${
          ev.ghost
            ? 'font-normal text-ink-400'
            : solid
              ? 'font-semibold text-white'
              : ev.dashed
                ? `font-medium ${TEACHER_TEXT[i]}`
                : 'font-medium text-ink-900'
        } ${ev.strike ? 'text-ink-400 line-through' : ''}`}
      >
        {ev.title}
      </span>
      {/* ✓ é EXCLUSIVO de aula realizada — janela consumida (dashed+dim) não herda */}
      {ev.dim && !ev.ghost && !ev.dashed && <span className="ml-0.5 text-[10px] font-bold text-ok-700">✓</span>}
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

function EventBlock({ p, top, height, left, width, hideLabel = false }: { p: Placed; top: number; height: number; left: string; width: string; hideLabel?: boolean }) {
  const { ev, start } = p
  const style = { top, height: Math.max(height, 18), left, width } as const
  const hoverTitle = ev.hoverExtra ? `${ev.title} — ${ev.hoverExtra}` : ev.title
  // item 14.1/14.5: camadas de FUNDO (disponibilidade e ocupada sem popup) não
  // têm rótulo grande nem roubam clique — o slot vazio embaixo continua vivo.
  // e2e 19/07 (agenda "bugada"): hideLabel cala o rótulo quando OUTRO bloco
  // cobre a zona do texto — o dado continua no title; texto sobreposto, nunca.
  if (ev.avail || (ev.ghost && !ev.popup)) {
    return (
      <div
        style={style}
        title={hoverTitle}
        className={`pointer-events-none absolute overflow-hidden rounded-chip px-1.5 py-0.5 whitespace-nowrap ${eventTone(ev)}`}
      >
        {ev.ghost && !hideLabel && (
          <span className="font-mono text-[10px] leading-none text-ink-400/80">{start.toFormat('HH:mm')} {ev.title}</span>
        )}
      </div>
    )
  }
  if (!ev.popup) {
    return (
      <div style={style} title={hoverTitle} className={`absolute overflow-hidden rounded-chip px-1.5 py-0.5 whitespace-nowrap ${eventTone(ev)}`}>
        {!hideLabel && <EventLabel ev={ev} start={start} />}
      </div>
    )
  }
  return (
    <details style={style} data-popup className={`absolute rounded-chip ${eventTone(ev)} open:z-20`}>
      <summary className="block h-full cursor-pointer list-none overflow-hidden px-1.5 py-0.5 whitespace-nowrap" title={hoverTitle}>
        {!hideLabel && <EventLabel ev={ev} start={start} />}
      </summary>
      <div className="absolute top-full left-0 z-30 mt-1 w-72 rounded-card border border-line bg-paper-0 p-3 shadow-(--shadow-pop)">
        {ev.popup}
      </div>
    </details>
  )
}

function TimeGrid({ days, events, tz, dayHref, todayISO, slotHref, slotPopup }: { days: DateTime[]; events: CalEvent[]; tz: string; dayHref: (d: string) => string; todayISO: string; slotHref?: (dateISO: string, timeHHmm: string) => string; slotPopup?: (dateISO: string, timeHHmm: string) => ReactNode }) {
  const placed = events.map((e) => place(e, tz))
  const byDay = new Map<string, Placed[]>()
  for (const p of placed) {
    const k = p.start.toFormat('yyyy-LL-dd')
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }
  const hours = placed.flatMap((p) => [p.start.hour, p.end.hour + (p.end.minute > 0 ? 1 : 0)])
  const hStart = Math.min(7, ...(hours.length ? [Math.min(...hours)] : []))
  const hEnd = Math.max(21, ...(hours.length ? [Math.max(...hours)] : []))
  const totalH = (hEnd - hStart) * HOUR_PX
  // linha do "agora": leitura por request é intencional (Server Component)
  const now = DateTime.now().setZone(tz)
  const nowTop = (now.hour + now.minute / 60 - hStart) * HOUR_PX

  return (
    <div className="overflow-x-auto rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
      <div className={days.length > 1 ? 'min-w-[640px]' : ''}>
        {/* cabeçalho dos dias — em dia único no celular a faixa de dias acima
            já mostra a seleção; o cabeçalho duplicado some */}
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
                <span className="text-[11px] tracking-wide text-ink-400 uppercase">{WEEKDAYS_SHORT[d.weekday - 1]}</span>
                <span
                  className={`text-sm font-semibold ${today ? 'flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-white' : 'text-ink-900'}`}
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
            {Array.from({ length: hEnd - hStart }, (_, i) => (
              <span key={i} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-ink-400" style={{ top: i * HOUR_PX }}>
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
            const bgEvents = dayEvents.filter((p) => p.ev.avail || p.ev.ghost || p.ev.dashed)
            const fgEvents = dayEvents.filter((p) => !(p.ev.avail || p.ev.ghost || p.ev.dashed))
            const pos = lanes(fgEvents)
            // e2e 19/07 (texto sobreposto): o rótulo mora no TOPO do bloco;
            // se um bloco da frente — ou um fundo de maior prioridade
            // (janela tracejada > ocupada > disponibilidade) — cobre essa
            // zona (~20 min), o fundo fica mudo (title preserva o dado).
            const LABEL_ZONE_MS = 20 * 60_000
            const coversLabel = (other: Placed, of: Placed) =>
              other.start.toMillis() < of.start.toMillis() + LABEL_ZONE_MS &&
              other.end.toMillis() > of.start.toMillis()
            const bgPriority = (p: Placed) => (p.ev.dashed ? 2 : p.ev.ghost ? 1 : 0)
            const bgMuted = new Map(
              bgEvents.map((p) => [
                p.ev.id,
                fgEvents.some((f) => coversLabel(f, p)) ||
                  bgEvents.some((o) => o !== p && bgPriority(o) > bgPriority(p) && coversLabel(o, p)),
              ]),
            )
            const today = iso === todayISO
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
                    aparece no hover, como no Google Agenda */}
                {(slotPopup || slotHref) &&
                  Array.from({ length: (hEnd - hStart) * 2 }, (_, i) => {
                    const hh = String(hStart + Math.floor(i / 2)).padStart(2, '0')
                    const mm = i % 2 === 0 ? '00' : '30'
                    const top = i * (HOUR_PX / 2)
                    // item 14.3 (quick-create): o clique abre o mini-form ALI,
                    // sem reload — <details> no padrão dos popups da casa.
                    if (slotPopup)
                      return (
                        <details
                          key={`slot-${i}`}
                          data-popup
                          className="group absolute right-0 left-0 z-0 open:z-30"
                          style={{ top, height: HOUR_PX / 2 }}
                        >
                          <summary
                            className="block h-full cursor-pointer list-none"
                            title={`Publicar às ${hh}:${mm}`}
                          >
                            <span className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-chip bg-paper-100 text-[11px] font-semibold text-brand-700 group-hover:flex group-open:flex">
                              ＋ {hh}:{mm}
                            </span>
                          </summary>
                          <div className={`absolute left-1 z-40 mt-1 w-64 rounded-card border border-line bg-paper-0 p-3 shadow-(--shadow-pop) ${i >= (hEnd - hStart) * 2 - 4 ? 'bottom-full mb-1' : 'top-full'}`}>
                            {slotPopup(iso, `${hh}:${mm}`)}
                          </div>
                        </details>
                      )
                    return (
                      <Link
                        key={`slot-${i}`}
                        href={slotHref!(iso, `${hh}:${mm}`)}
                        className="group absolute right-0 left-0 z-0"
                        style={{ top, height: HOUR_PX / 2 }}
                        title={`Publicar janela ${hh}:${mm}`}
                      >
                        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-chip bg-paper-100 text-[11px] font-semibold text-brand-700 group-hover:flex">
                          ＋ {hh}:{mm}
                        </span>
                      </Link>
                    )
                  })}
                {bgEvents.map((p) => {
                  const top = (p.start.hour + p.start.minute / 60 - hStart) * HOUR_PX
                  const height = Math.max(p.end.diff(p.start, 'hours').hours * HOUR_PX - 2, 18)
                  return (
                    <EventBlock key={p.ev.id} p={p} top={top} height={height} left="2px" width="calc(100% - 4px)" hideLabel={bgMuted.get(p.ev.id)} />
                  )
                })}
                {fgEvents.map((p) => {
                  const { lane, of } = pos.get(p.ev.id) ?? { lane: 0, of: 1 }
                  const top = (p.start.hour + p.start.minute / 60 - hStart) * HOUR_PX
                  const height = Math.max(p.end.diff(p.start, 'hours').hours * HOUR_PX - 2, 18)
                  const width = `calc(${100 / of}% - 4px)`
                  const left = `calc(${(100 / of) * lane}% + 2px)`
                  return <EventBlock key={p.ev.id} p={p} top={top} height={height} left={left} width={width} />
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
    if (ev.dashed || ev.ghost) continue
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
            <span className="text-[10px] tracking-wide text-ink-400 uppercase">{WEEKDAYS_SHORT[d.weekday - 1]}</span>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                today ? 'bg-ink-900 text-white' : selected ? 'text-ink-900' : 'text-ink-600'
              }`}
            >
              {d.day}
            </span>
            <span className="flex h-1.5 items-center gap-0.5">
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

function MonthGrid({ anchor, events, tz, dayHref, todayISO }: { anchor: DateTime; events: CalEvent[]; tz: string; dayHref: (d: string) => string; todayISO: string }) {
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
    <div className="overflow-x-auto rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS_SHORT.map((w) => (
            <span key={w} className="px-2 py-2 text-center text-[11px] tracking-wide text-ink-400 uppercase">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const iso = d.toFormat('yyyy-LL-dd')
            const inMonth = d.month === anchor.month
            const today = iso === todayISO
            const dayEvents = (byDay.get(iso) ?? []).sort((a, b) => a.start.toMillis() - b.start.toMillis())
            const extra = dayEvents.length - 3
            return (
              <div
                key={iso}
                className={`min-h-28 border-b border-l border-line-soft p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${today ? 'bg-paper-100/50' : ''}`}
              >
                <Link
                  href={dayHref(iso)}
                  className={`float-right flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors hover:bg-paper-100 ${
                    today ? 'bg-ink-900 text-white hover:bg-ink-900' : inMonth ? 'text-ink-900' : 'text-ink-400/60'
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
                      <details key={p.ev.id} data-popup className={`relative rounded-chip ${eventTone(p.ev)} open:z-20`}>
                        <summary className="block cursor-pointer list-none truncate px-1.5 py-0.5">
                          <EventLabel ev={p.ev} start={p.start} />
                        </summary>
                        <div
                          className={`absolute top-full z-30 mt-1 w-72 rounded-card border border-line bg-paper-0 p-3 shadow-(--shadow-pop) ${i % 7 >= 4 ? 'right-0' : 'left-0'}`}
                        >
                          {p.ev.popup}
                        </div>
                      </details>
                    )
                  })}
                  {extra > 0 && (
                    <Link href={dayHref(iso)} className="px-1.5 text-[11px] font-semibold text-brand-700 hover:underline">
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

export function CalendarGrid({ events, view, anchor, tz, dayHref, todayISO, slotHref, slotPopup }: Props) {
  const a = DateTime.fromISO(anchor, { zone: tz })
  if (view === 'mes') return <MonthGrid anchor={a} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} />
  const weekDays = Array.from({ length: 7 }, (_, i) => a.startOf('day').minus({ days: a.weekday - 1 }).plus({ days: i }))
  const days = view === 'dia' ? [a.startOf('day')] : weekDays
  return (
    <div className="flex flex-col gap-2">
      <DayStrip weekDays={weekDays} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} selectedISO={a.toFormat('yyyy-LL-dd')} />
      {/* Semana no celular: 7 colunas espremidas não dá — mostra o dia
          selecionado; a faixa acima navega. Desktop mantém as 7 colunas. */}
      {view === 'semana' && (
        <div className="sm:hidden">
          <TimeGrid days={[a.startOf('day')]} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} slotHref={slotHref} slotPopup={slotPopup} />
        </div>
      )}
      <div className={`${view === 'semana' ? 'hidden sm:block' : ''} ${view === 'dia' ? 'max-w-3xl' : ''}`}>
        <TimeGrid days={days} events={events} tz={tz} dayHref={dayHref} todayISO={todayISO} slotHref={slotHref} slotPopup={slotPopup} />
      </div>
    </div>
  )
}
