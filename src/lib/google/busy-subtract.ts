// Item 14.6 (veredito do e2e) — dedup defensivo da camada "ocupada": o bloco
// busy do Google que coincide com uma AULA do sistema é eco (evento manual
// antigo da professora ou sobra do espelho) e não deve virar bloco concorrente.
// Subtração PURA de intervalos: devolve só as sobras do busy que NÃO estão
// cobertas por aulas — sobra parcial continua aparecendo (compromisso real).

export interface Interval {
  startUtc: string
  endUtc: string
}

const MIN_REMAINDER_MS = 10 * 60_000 // sobra menor que 10min é ruído visual

/** Subtrai de cada bloco busy a união dos intervalos de aulas. */
export function subtractBusy(busy: Interval[], classes: Interval[]): Interval[] {
  const cls = classes
    .map((c) => ({ s: Date.parse(c.startUtc), e: Date.parse(c.endUtc) }))
    .filter((c) => Number.isFinite(c.s) && Number.isFinite(c.e) && c.e > c.s)
    .sort((a, b) => a.s - b.s)

  const out: Interval[] = []
  for (const b of busy) {
    let segments = [{ s: Date.parse(b.startUtc), e: Date.parse(b.endUtc) }]
    if (!Number.isFinite(segments[0].s) || !Number.isFinite(segments[0].e)) continue
    for (const c of cls) {
      const next: typeof segments = []
      for (const seg of segments) {
        if (c.e <= seg.s || c.s >= seg.e) {
          next.push(seg) // sem interseção
          continue
        }
        if (c.s > seg.s) next.push({ s: seg.s, e: c.s }) // sobra à esquerda
        if (c.e < seg.e) next.push({ s: c.e, e: seg.e }) // sobra à direita
      }
      segments = next
      if (!segments.length) break
    }
    for (const seg of segments) {
      if (seg.e - seg.s >= MIN_REMAINDER_MS) {
        out.push({ startUtc: new Date(seg.s).toISOString(), endUtc: new Date(seg.e).toISOString() })
      }
    }
  }
  return out
}
