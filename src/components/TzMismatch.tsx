'use client'
// Item 7 (veredito adversarial): o portal fica em SILÊNCIO sobre fuso por
// padrão — este aviso só aparece na EXCEÇÃO. Compara o OFFSET ATUAL do fuso do
// navegador com o do fuso cadastrado: nomes IANA diferentes podem ser o MESMO
// relógio (America/Bahia × America/Sao_Paulo) — comparar nome dispararia falso
// alarme; offset divergente é exatamente "o relógio que você vê não é o seu".
//
// fuso-ok-arquivo: este é O componente cuja FUNÇÃO é ler o relógio do
// navegador e compará-lo com o cadastro (Lei 1 na porta nova, Onda 1 · M1
// item 6). Nenhuma hora sai daqui para a tela: só a comparação de offset e a
// hora do fuso CADASTRADO, que é o que o aviso precisa dizer.
//
// COMO o valor chega à tela (revisão adversarial nº 1, C11a): por
// `useSyncExternalStore`, não por `setState` dentro de efeito. O comportamento
// é o mesmo de antes — no servidor e na hidratação o aviso não existe (o
// snapshot de servidor é `null`), e logo depois o React lê o snapshot do
// cliente e o aviso aparece SE o offset divergir. O que muda é que não há mais
// render extra disparado de dentro de um efeito, que é o que a regra do React
// Compiler cobra.
//
// POR QUE ELE ESCUTA (revisão adversarial retroativa nº 2, B5): a versão
// anterior assinava o NADA (`() => () => {}`) e memoizava por NOME do fuso, o
// que congelava o veredito para sempre. Os dois casos em que isso mente são
// justamente os do negócio: a aluna que VIAJA (o dispositivo troca de zona com
// a aba aberta) e a transição de DST (mesmo nome de zona, offset novo —
// Orlando e Lisboa viram em datas diferentes do Brasil). Agora o veredito é
// invalidado em `focus`, `visibilitychange` e `pageshow` — os três momentos em
// que a pessoa volta para a aba —, o cache leva o OFFSET atual (não só o nome)
// e a hora exibida é recalculada junto.
import { useCallback, useRef, useSyncExternalStore } from 'react'

/**
 * Volta para a aba = hora de reconferir. `visibilitychange` mora no
 * `document`; `focus` e `pageshow` (volta do bfcache — o caso do celular que
 * ficou no bolso durante o voo) moram no `window`.
 */
function assinarRetomada(avisar: () => void): () => void {
  window.addEventListener('focus', avisar)
  window.addEventListener('pageshow', avisar)
  document.addEventListener('visibilitychange', avisar)
  return () => {
    window.removeEventListener('focus', avisar)
    window.removeEventListener('pageshow', avisar)
    document.removeEventListener('visibilitychange', avisar)
  }
}

function currentOffset(zone: string, now: Date): string | null {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? null
    )
  } catch {
    return null
  }
}

/** Chave do veredito: fuso cadastrado, fuso do aparelho e os DOIS offsets do
 *  instante. É o que muda numa viagem ou numa virada de DST — e é por isso que
 *  o nome do fuso, sozinho, não serve de cache. */
function chaveDoVeredito(tz: string): string {
  try {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    const now = new Date()
    return `${tz}|${browser}|${currentOffset(browser, now)}|${currentOffset(tz, now)}`
  } catch {
    return `${tz}|?`
  }
}

function avisoDeFuso(tz: string): string | null {
  try {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!browser || browser === tz) return null
    const now = new Date()
    const a = currentOffset(browser, now)
    const b = currentOffset(tz, now)
    if (!a || !b || a === b) return null
    const hora = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(now)
    return `Seu dispositivo parece estar em outro fuso — os horários aqui seguem o seu cadastro (agora são ${hora}).`
  } catch {
    // cortesia: o aviso nunca pode quebrar o portal
    return null
  }
}

export function TzMismatch({ tz }: { tz: string }) {
  // O snapshot precisa ser ESTÁVEL entre leituras do MESMO render (senão o
  // React relê em laço). Duas coisas o invalidam, e só elas: a chave do
  // veredito ter mudado (viagem / DST) ou uma retomada da aba ter pedido
  // reconferência — aí a mensagem é recalculada, com a hora do momento.
  const memo = useRef<{ chave: string; ciclo: number; msg: string | null } | null>(null)
  const ciclo = useRef(0)

  const assinar = useCallback((avisar: () => void) => {
    const invalidar = () => {
      ciclo.current += 1
      avisar()
    }
    return assinarRetomada(invalidar)
  }, [])

  const ler = useCallback(() => {
    const chave = chaveDoVeredito(tz)
    const anterior = memo.current
    if (anterior && anterior.chave === chave && anterior.ciclo === ciclo.current) {
      return anterior.msg
    }
    const atual = { chave, ciclo: ciclo.current, msg: avisoDeFuso(tz) }
    memo.current = atual
    return atual.msg
  }, [tz])

  const msg = useSyncExternalStore(assinar, ler, () => null)

  if (!msg) return null
  return (
    <p className="rounded-card border border-warn-700/30 bg-warn-wash px-4 py-2.5 text-sm font-medium text-warn-700">
      {msg}
    </p>
  )
}
