'use client'

// Leva 5 (itens 1–4 do e2e) — CIDADE determina o fuso; o humano nunca digita
// "America/…". Busca offline (GeoNames CC-BY, base podada servida como asset
// estático em public/geo/cities.json — fora do grafo do bundler/TS de
// propósito: 1,6 MB inflavam o type-check além da RAM do VPS e o chunk JS;
// como asset, o Cloudflare cacheia. Carregada no primeiro foco) com lista
// PRÓPRIA estilizada (mata o datalist ilegível do Safari — item 2) e hora
// atual da cidade ao lado (conferência visual — item 1). Ao escolher, grava
// o fuso IANA (e opcionalmente cidade/país canônicos) em inputs hidden — a
// incoerência cidade×país×fuso (item 4) morre por construção. O validador
// IANA do banco continua como cinto (Lei 1).
//
// LOTE 6 · G3 (26/07/2026) — "clicar em 'Cuiabá, Mato Grosso — Brasil'
// seleciona, mas o dropdown continua aberto". A abertura da lista era efeito
// colateral de uma função ASSÍNCRONA sem dono: cada tecla fazia
// `await loadDataset()` e, na volta, `setResults(...) + setOpen(true)` sem
// perguntar se aquela ainda era a última tecla. Com o catálogo frio, as
// primeiras teclas disparavam vários downloads de 1,6 MB (não havia dedupe) e
// as respostas voltavam fora de ordem — a última a chegar podia ser a de uma
// tecla ANTERIOR ao clique, e ela reabria a lista logo depois de a escolha ter
// fechado. Consertado em quatro frentes:
//   1. o carregador virou módulo com uma requisição só (src/lib/geo/dataset.ts);
//   2. cada busca carrega uma GERAÇÃO; resposta de geração velha não mexe na
//      tela (e escolher incrementa a geração, matando o que estiver no ar);
//   3. escolher fecha, devolve o foco ao campo e NÃO reabre: o foco só traz a
//      lista de volta enquanto não houver escolha firmada;
//   4. a escolha commita no `click`, com `preventDefault` no `mousedown` — o
//      campo nunca chega a perder o foco, então a corrida blur×click não existe.
// De quebra, o que faltava para "escolher com Enter": setas navegam, Enter
// escolhe (sem enviar o formulário) e Esc fecha.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { carregarCidades } from '@/lib/geo/dataset'
import { currentTimeIn, searchCities, type GeoCity } from '@/lib/geo/search'
import { tzLabel } from '@/lib/format'

/** nome de exibição: apelido pt-BR quando existe ("Milão" > "Milan") */
function displayName(c: GeoCity): string {
  return c.b ? c.b.split('|')[0] : c.n
}

export interface CityPickerProps {
  /** name do input hidden do fuso IANA (obrigatório — é o que o motor usa) */
  tzName: string
  /** names opcionais para gravar cidade/país canônicos (form de aluno) */
  cityName?: string
  countryName?: string
  defaultTz?: string | null
  defaultCity?: string | null
  defaultCountry?: string | null
  required?: boolean
  placeholder?: string
  small?: boolean
  /**
   * Avisa quem usa o campo QUAL fuso foi escolhido, no ato da escolha.
   *
   * Existe por causa do grave 3 do A4: o balão da agenda precisa RECALCULAR a
   * data e a hora do formulário para o relógio da cidade nova — antes, trocar a
   * cidade só trocava o rótulo e deixava os algarismos de Cuiabá nos campos. O
   * `cidade` vem do próprio catálogo (nome de exibição), então quem escuta não
   * precisa traduzir IANA para gente.
   */
  aoEscolher?: (escolha: { tz: string; cidade: string }) => void
}

export function CityPicker({
  tzName,
  cityName,
  countryName,
  defaultTz,
  defaultCity,
  defaultCountry,
  required,
  placeholder = 'digite a cidade… (ex.: Cuiabá, Milão, Nova York)',
  small,
  aoEscolher,
}: CityPickerProps) {
  const [text, setText] = useState(
    defaultCity
      ? [defaultCity, defaultCountry].filter(Boolean).join(', ')
      : defaultTz
        ? tzLabel(defaultTz)
        : '',
  )
  const [sel, setSel] = useState<{ city: string; country: string; tz: string } | null>(
    defaultTz ? { city: defaultCity ?? '', country: defaultCountry ?? '', tz: defaultTz } : null,
  )
  const [results, setResults] = useState<GeoCity[]>([])
  const [open, setOpen] = useState(false)
  /** opção destacada pelo teclado (−1 = nenhuma) */
  const [ativo, setAtivo] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** geração da busca: só a última manda na tela */
  const geracao = useRef(0)
  /**
   * SUPRESSÃO SÍNCRONA da reabertura (revisão nº 5 do Sol).
   *
   * `choose` devolve o foco ao campo, e devolver o foco dispara `onFocus` no
   * MESMO tique. O guarda de lá lia `sel` — que é ESTADO, e estado do React só
   * existe no render seguinte: no tique do `focus()` ele ainda vale `null`, e a
   * lista reabria sozinha. No mouse o efeito passava despercebido (o
   * `preventDefault` do mousedown evita a ida e volta do foco), mas no TOQUE e
   * no clique VIRTUAL das tecnologias assistivas o foco chega de verdade — e
   * era ali que a lista teimava em voltar.
   *
   * Um `ref` muda no ato. A regra fica sendo: escolha firmada cala o foco; só
   * DIGITAR de novo (que zera esta marca no `onChange`) traz a lista de volta.
   */
  const escolhaFirmada = useRef(false)
  const listaId = useId()

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  async function onChange(value: string) {
    const minha = ++geracao.current
    // digitar é o gesto que reabre a lista: a supressão da escolha cai aqui.
    escolhaFirmada.current = false
    setText(value)
    setSel(null)
    setAtivo(-1)
    inputRef.current?.setCustomValidity(required ? 'Escolha uma cidade da lista.' : '')
    const cities = await carregarCidades()
    // chegou atrasada (outra tecla ou uma ESCOLHA já aconteceram): cala a boca.
    // Sem isto, uma resposta velha reabria a lista depois de o clique fechá-la.
    if (minha !== geracao.current) return
    setResults(searchCities(cities, value))
    setOpen(true)
  }

  function choose(c: GeoCity) {
    geracao.current++ // invalida qualquer busca no ar: nada reabre depois disto
    escolhaFirmada.current = true // …e o foco de volta ao campo também não reabre
    const nome = displayName(c)
    setSel({ city: nome, country: c.c, tz: c.t })
    setText(`${nome}, ${c.c}`)
    setAtivo(-1)
    setOpen(false)
    inputRef.current?.setCustomValidity('')
    // devolve o foco ao campo (no caminho do mouse ele nem chega a sair, por
    // causa do preventDefault no mousedown; no toque e no Enter, chega)
    inputRef.current?.focus()
    // …e só DEPOIS de a escolha estar firmada quem escuta é avisado: é aqui que
    // o balão da agenda recalcula data/hora para o relógio da cidade nova.
    aoEscolher?.({ tz: c.t, cidade: nome })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setAtivo(-1)
      return
    }
    if (!open || results.length === 0) {
      // seta para baixo com resultados guardados e sem escolha firmada reabre
      if (e.key === 'ArrowDown' && !sel && results.length > 0) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAtivo((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      // com a lista aberta, Enter ESCOLHE (a destacada, ou a primeira) e não
      // envia o formulário — enviar sem cidade escolhida só produziria o erro
      // de validade que o próprio campo já carrega.
      e.preventDefault()
      choose(results[ativo >= 0 ? ativo : 0])
    }
  }

  const hora = sel ? currentTimeIn(sel.tz) : null
  const listaAberta = open && results.length > 0

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={text}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={listaAberta}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={listaAberta && ativo >= 0 ? `${listaId}-${ativo}` : undefined}
        onChange={(e) => void onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          void carregarCidades()
          // Escolha firmada NÃO reabre a lista: voltar ao campo depois de
          // escolher tem de deixar a tela quieta. A marca é o REF (síncrono);
          // `sel` entra só como cinto, para o caso de o campo já nascer com
          // cidade e o primeiro foco não ter passado por `choose`.
          if (!escolhaFirmada.current && !sel && results.length) setOpen(true)
        }}
        className={`w-full rounded-input border border-line bg-paper-0 text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600 ${
          small ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2.5 text-sm'
        }`}
      />
      <input type="hidden" name={tzName} value={sel?.tz ?? ''} />
      {cityName && <input type="hidden" name={cityName} value={sel?.city ?? ''} />}
      {countryName && <input type="hidden" name={countryName} value={sel?.country ?? ''} />}

      {/* A HORA ATUAL DA CIDADE É DADO, não legenda (Sol · rodada 1 do A4,
          médio 5). É a única conferência visual de que a cidade escolhida é a
          certa — e é ela que evita marcar a aula no fuso errado, que é o erro
          mais caro desta tela. Estava em `text-xs text-ink-400`, o degrau do
          APOIO: apagar essa linha tira uma decisão do usuário, logo ela nunca
          foi apoio. Sobe para o piso da régua do AGENTS.md, e o NÚMERO ganha
          peso (é ele que se compara com o relógio da mesa). */}
      {sel && hora && (
        <p className="mt-1 text-sm text-ink-600">
          agora são{' '}
          <span className="font-mono font-semibold tabular-nums text-ink-900">{hora}</span> em{' '}
          <span className="font-medium text-ink-900">{sel.city || tzLabel(sel.tz)}</span> — fuso
          aplicado automaticamente
        </p>
      )}

      {listaAberta && (
        <ul
          id={listaId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-card border border-line bg-paper-0 py-1 shadow-(--shadow-pop)"
        >
          {results.map((c, i) => (
            <li key={`${c.n}|${c.a}|${c.c}|${i}`} role="presentation">
              <button
                type="button"
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === ativo}
                // A lista não é caminho de TAB: quem navega por teclado usa as
                // setas no campo (aria-activedescendant). Sem isto, o tab do
                // formulário passearia por 8 cidades.
                tabIndex={-1}
                // O idioma da corrida blur×click: segurar o foco no campo no
                // MOUSEDOWN e commitar no CLICK. Sem o preventDefault, o campo
                // perde o foco, o `mousedown` de fora fecha a lista e o clique
                // pode nem chegar ao botão.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm text-ink-900 transition-colors hover:bg-paper-100 ${
                  i === ativo ? 'bg-paper-100' : ''
                }`}
              >
                <span className="min-w-0 truncate">
                  {displayName(c)}
                  <span className="text-ink-400">{c.a ? `, ${c.a}` : ''} — {c.c}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-ink-400">
                  {currentTimeIn(c.t) ?? ''}
                </span>
              </button>
            </li>
          ))}
          <li className="border-t border-line-soft px-3 pt-1 pb-0.5 text-[10px] text-ink-400" role="presentation">
            cidades © GeoNames (CC-BY)
          </li>
        </ul>
      )}
    </div>
  )
}
