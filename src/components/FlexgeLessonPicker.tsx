'use client'

// Cronograma M3-UI (20/07/2026) — escolher a AULA PRONTA da Flexge para um
// módulo do plano. Mesmo padrão do CityPicker: catálogo como asset estático
// (public/flexge/lesson-library.json — 393 aulas colhidas da Lesson Library),
// carregado no primeiro foco, lista própria estilizada, e o escolhido vira
// inputs hidden (id + href) — a professora nunca digita link na mão.
//
// M3-c4 · B1 (varredura) — "mesmo padrão do CityPicker" incluía, sem querer, o
// DEFEITO do CityPicker de antes do lote 6 · G3: a busca era assíncrona e sem
// dono. Cada tecla chamava `loadDataset()` e, na volta, `setResults(...)` sem
// perguntar se aquela ainda era a última tecla; com o catálogo frio, as
// primeiras teclas disparavam vários downloads (não havia dedupe) e as
// respostas voltavam fora de ordem — a última a chegar podia ser a de uma tecla
// ANTERIOR à escolha, repovoando a lista depois de ela ter sido fechada. Mesmas
// frentes da correção de lá:
//   1. UMA requisição só, com dedupe e sem envenenar o cache em caso de falha;
//   2. cada busca carrega uma GERAÇÃO — resposta de geração velha não mexe na
//      tela, e escolher incrementa a geração;
//   3. escolher fecha e NÃO reabre: o foco só traz a lista de volta enquanto
//      não houver escolha firmada (marca em `ref`, síncrona);
//   4. a escolha commita no `click`, com `preventDefault` no `mousedown` — o
//      campo não perde o foco no meio do gesto;
//   5. e o teclado que faltava: setas navegam, Enter escolhe (sem enviar o
//      formulário), Esc fecha.
import { useEffect, useId, useRef, useState, type KeyboardEvent as TeclaDoReact } from 'react'

interface Lesson {
  id: string
  href: string
  title: string
  sequence: string
  levels: string[]
  skill: string | null
  topics: string[]
}

/** Carregador com DEDUPE: N teclas simultâneas = uma requisição, e falha não
 *  fica em cache (a tecla seguinte tenta de novo). Mesma forma do
 *  `criarCarregadorDeCidades` — aqui local porque o payload é outro. */
let CATALOGO: Promise<Lesson[]> | null = null
async function loadDataset(): Promise<Lesson[]> {
  if (!CATALOGO) {
    CATALOGO = (async () => {
      const res = await fetch('/flexge/lesson-library.json')
      if (!res.ok) throw new Error('catálogo indisponível')
      return ((await res.json()) as { aulas: Lesson[] }).aulas
    })().catch(() => {
      CATALOGO = null
      return []
    })
  }
  return CATALOGO
}

export function FlexgeLessonPicker({
  idName,
  hrefName,
  level,
  defaultId,
  defaultTitle,
}: {
  idName: string
  hrefName: string
  /** nível do aluno — pré-filtra o catálogo (limpar a busca mostra todos) */
  level?: string | null
  defaultId?: string | null
  defaultTitle?: string | null
}) {
  const [query, setQuery] = useState(defaultTitle ?? '')
  const [chosen, setChosen] = useState<{ id: string; href: string } | null>(
    defaultId ? { id: defaultId, href: `/lessons/library/${defaultId}/details` } : null,
  )
  const [results, setResults] = useState<Lesson[]>([])
  const [open, setOpen] = useState(false)
  const [ativo, setAtivo] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** geração da busca: só a última manda na tela */
  const geracao = useRef(0)
  /** escolha firmada cala o foco; só digitar de novo reabre a lista */
  const escolhaFirmada = useRef(false)
  const listaId = useId()

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function search(q: string, abrir: boolean) {
    const minha = ++geracao.current
    const all = await loadDataset()
    // chegou atrasada (outra tecla ou uma ESCOLHA já aconteceram): cala a boca.
    if (minha !== geracao.current) return
    const nq = q.trim().toLowerCase()
    const doNivel = level ? all.filter((l) => l.levels.includes(level)) : all
    const base = nq
      ? (doNivel.length ? doNivel : all).filter(
          (l) =>
            l.title.toLowerCase().includes(nq) ||
            l.sequence.toLowerCase().includes(nq) ||
            l.topics.some((t) => t.toLowerCase().includes(nq)),
        )
      : doNivel
    setResults(base.slice(0, 12))
    if (abrir) setOpen(true)
  }

  function choose(l: Lesson) {
    geracao.current++ // invalida qualquer busca no ar: nada reabre depois disto
    escolhaFirmada.current = true
    setChosen({ id: l.id, href: l.href })
    setQuery(l.title)
    setAtivo(-1)
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: TeclaDoReact<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setAtivo(-1)
      return
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAtivo((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[ativo >= 0 ? ativo : 0])
    }
  }

  const listaAberta = open && results.length > 0

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input type="hidden" name={idName} value={chosen?.id ?? ''} />
      <input type="hidden" name={hrefName} value={chosen?.href ?? ''} />
      <input
        ref={inputRef}
        value={query}
        role="combobox"
        aria-expanded={listaAberta}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={listaAberta && ativo >= 0 ? `${listaId}-${ativo}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          // digitar é o gesto que reabre a lista: a supressão da escolha cai aqui
          escolhaFirmada.current = false
          setQuery(e.target.value)
          setChosen(null)
          setAtivo(-1)
          void search(e.target.value, true)
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          // escolha firmada NÃO reabre a lista (o `focus()` de `choose` chega
          // no mesmo tique, quando o estado ainda não existe — por isso a marca
          // é um ref).
          if (escolhaFirmada.current || chosen) return
          void search(query, true)
        }}
        placeholder={level ? `buscar aula (nível ${level})…` : 'buscar aula da Flexge…'}
        className="min-h-11 w-full rounded-input border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600"
        aria-label="Aula da Flexge"
      />
      {chosen && (
        <p className="mt-1 text-[11px] text-ok-700">aula selecionada ✓ (o link vai junto no plano)</p>
      )}
      {listaAberta && (
        <ul
          id={listaId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-line bg-paper-0 p-1 shadow-(--shadow-pop)"
        >
          {results.map((l, i) => (
            <li key={l.id} role="presentation">
              <button
                type="button"
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === ativo}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(l)}
                className={`flex w-full flex-col items-start rounded-input px-2 py-1.5 text-left hover:bg-paper-100 ${
                  i === ativo ? 'bg-paper-100' : ''
                }`}
              >
                <span className="text-sm font-medium text-ink-900">{l.title}</span>
                <span className="text-[11px] text-ink-400">
                  {l.sequence}
                  {l.skill ? ` · ${l.skill}` : ''} · {l.levels.join('/')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
