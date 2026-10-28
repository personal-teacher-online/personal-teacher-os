'use client'

// QA 14/07/2026: campo de telefone com seletor de país pesquisável — o admin
// digita "Portugal" ou "+351" em vez de montar +5565… na mão. O valor que VIAJA
// para a action continua o E.164 canônico COM '+' (pino em tests/fase3-dispatch)
// num input hidden — nenhuma action muda.
//
// Client component deliberado (exceção de UX aprovada no QA): composição
// país+número precisa de estado local. A validação REAL continua na action (E164).
//
// M3-c4 · B1 — "ESCOLHI PORTUGAL E A LISTA CONTINUOU ABERTA". Mesma classe de
// corrida que o lote 6 · G3 fechou no CityPicker, com um agravante que só existe
// aqui: o campo nasce DENTRO de um `<label>` (as peças do formulário embrulham
// o controle quando não recebem `para`), e um `<label>` reencaminha a ativação
// para o seu controle rotulado — que, neste campo, era o BOTÃO do país, o
// primeiro elemento rotulável da árvore. Resultado: o clique na opção fechava a
// lista e, no mesmo laço de eventos, o clique reencaminhado ao gatilho a
// reabria. Quatro frentes, as mesmas do CityPicker mais a raiz local:
//   1. o campo passa a EXPOR um `id` (prop `id`) para o rótulo apontar por
//      `for` — assim o `<label>` rotula o NÚMERO, não o país, e o
//      reencaminhamento de ativação deixa de existir (é por isso que quem usa
//      este campo agora passa `<Campo para={…}>`);
//   2. a escolha commita no `click`, com `preventDefault` no `mousedown` — o
//      foco não sai da busca no meio do gesto, então a corrida blur×click
//      também não existe;
//   3. uma marca SÍNCRONA (`ref`, não estado) cala a reabertura do gatilho pelo
//      tique seguinte: estado do React só existiria no próximo render, tarde
//      demais para um clique que chega na MESMA volta do laço;
//   4. teclado de combobox de verdade: setas navegam, Enter escolhe (sem enviar
//      o formulário), Esc fecha.
// Não há geração de busca aqui — e não por esquecimento: a lista de países é
// uma constante do módulo, não um `fetch`. Sem resposta atrasada, não há
// resposta atrasada para calar.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as TeclaDoReact,
} from 'react'

interface Country {
  iso: string
  name: string
  dial: string // com '+'
  flag: string
}

// Lista curta e suficiente para a escala da escola (alunos BR + fusos já vistos
// em produção: EUA, Portugal, Espanha…). Texto livre da busca também acha por DDI.
const COUNTRIES: Country[] = [
  { iso: 'BR', name: 'Brasil', dial: '+55', flag: '🇧🇷' },
  { iso: 'US', name: 'Estados Unidos', dial: '+1', flag: '🇺🇸' },
  { iso: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹' },
  { iso: 'ES', name: 'Espanha', dial: '+34', flag: '🇪🇸' },
  { iso: 'GB', name: 'Reino Unido', dial: '+44', flag: '🇬🇧' },
  { iso: 'IE', name: 'Irlanda', dial: '+353', flag: '🇮🇪' },
  { iso: 'FR', name: 'França', dial: '+33', flag: '🇫🇷' },
  { iso: 'DE', name: 'Alemanha', dial: '+49', flag: '🇩🇪' },
  { iso: 'IT', name: 'Itália', dial: '+39', flag: '🇮🇹' },
  { iso: 'CA', name: 'Canadá', dial: '+1', flag: '🇨🇦' },
  { iso: 'AU', name: 'Austrália', dial: '+61', flag: '🇦🇺' },
  { iso: 'JP', name: 'Japão', dial: '+81', flag: '🇯🇵' },
  { iso: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷' },
  { iso: 'MX', name: 'México', dial: '+52', flag: '🇲🇽' },
  { iso: 'CL', name: 'Chile', dial: '+56', flag: '🇨🇱' },
  { iso: 'NL', name: 'Países Baixos', dial: '+31', flag: '🇳🇱' },
  { iso: 'CH', name: 'Suíça', dial: '+41', flag: '🇨🇭' },
  { iso: 'AE', name: 'Emirados Árabes', dial: '+971', flag: '🇦🇪' },
]

const inputCls =
  'min-h-11 rounded-input border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600'

function normalize(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Decompõe um E.164 salvo em (país, número local) para edição — match do DDI
 *  mais longo; sem match, cai no BR. */
function splitE164(e164: string | null | undefined): { iso: string; local: string } {
  if (!e164) return { iso: 'BR', local: '' }
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => e164.startsWith(c.dial))
  if (!match) return { iso: 'BR', local: e164.replace(/^\+/, '') }
  return { iso: match.iso, local: e164.slice(match.dial.length) }
}

/**
 * Quantos dígitos o número LOCAL pode ter, dado o DDI escolhido (B6 · item 6).
 *
 * A régra vem do E.164, que é o que a action e o driver do WhatsApp exigem:
 * de 10 a 15 dígitos CONTANDO o código do país. Logo, a faixa do campo visível
 * (que não contém o DDI) é a mesma faixa menos os dígitos do DDI — com +55 são
 * 8 a 13, com +351 são 7 a 12. Um mínimo fixo aqui estaria errado em metade dos
 * países, que é exatamente o tipo de "validação" que reprova dado bom.
 */
export function faixaLocal(dial: string): { min: number; max: number } {
  const ddi = dial.replace(/\D/g, '').length
  return { min: Math.max(1, 10 - ddi), max: 15 - ddi }
}

export function CountryPhoneField({
  id,
  name,
  defaultValue,
  required = false,
  autoFocus = false,
  ariaLabel = 'Número de WhatsApp (sem o código do país)',
}: {
  /** `id` do campo do NÚMERO — é ele que o rótulo da tela deve apontar */
  id?: string
  /** nome do campo E.164 que a action lê (input hidden) */
  name: string
  /** E.164 salvo (com '+') para edição, se houver */
  defaultValue?: string | null
  required?: boolean
  /** foca o campo do número na chegada (fluxo guiado ciência→perfil) */
  autoFocus?: boolean
  /**
   * Rótulo INTERNO do campo do número. `null` quando a tela já tem um
   * `<label htmlFor>` visível apontando o `id`: um `aria-label` aqui SOBREPÕE
   * esse rótulo (WCAG 2.5.3, Label in Name — quem dita por voz fala o texto
   * que VÊ, e o nome acessível seria outro). Nesse modo a dica "sem o código
   * do país" vira `aria-describedby`, que complementa sem sobrepor. O default
   * preserva os chamadores que rotulam por embrulho, sem `for`→`id`.
   */
  ariaLabel?: string | null
}) {
  const initial = splitE164(defaultValue)
  const [iso, setIso] = useState(initial.iso)
  const [local, setLocal] = useState(initial.local)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  /** opção destacada pelo teclado (−1 = nenhuma) */
  const [ativo, setAtivo] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const numeroRef = useRef<HTMLInputElement>(null)
  /**
   * SUPRESSÃO SÍNCRONA da reabertura. Escolher fecha a lista e devolve o foco
   * ao número; o clique que o `<label>` ainda pode reencaminhar ao gatilho
   * chega na MESMA volta do laço de eventos, e o `onClick` de lá reabriria a
   * lista. Um `ref` muda no ato (estado só existiria no próximo render), e o
   * `setTimeout(…, 0)` apaga a marca já na volta seguinte — clique de verdade
   * do usuário, que chega numa nova volta, continua abrindo a lista na hora.
   */
  const escolhaFirmada = useRef(false)
  const listaId = useId()
  const dicaId = useId()

  // QA item 4: popup fecha ao clicar fora; Esc fecha pelo teclado (a11y 16/07).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const country = COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0]
  const digits = local.replace(/\D/g, '')
  const e164 = digits ? `${country.dial}${digits}` : ''
  const { min: minDigitos, max: maxDigitos } = faixaLocal(country.dial)

  // B6 · item 6 — a antecipação do E.164, com a frase da casa. A action já
  // recusa (`/^\+[1-9]\d{9,14}$/`) e é ela a fonte da verdade; o que faltava era
  // a tela dizer ANTES, no campo, em vez de mandar a pessoa pelo caminho todo
  // para receber "Número de WhatsApp inválido" como recado de página inteira.
  // `setCustomValidity` (e não só o `pattern`) porque a frase precisa contar a
  // conta: quantos dígitos, e com qual DDI.
  useEffect(() => {
    const el = numeroRef.current
    if (!el) return
    el.setCustomValidity(
      digits.length > 0 && (digits.length < minDigitos || digits.length > maxDigitos)
        ? `Confira o número: com ${country.dial} são ${minDigitos} a ${maxDigitos} dígitos (DDD e número).`
        : '',
    )
  }, [digits, minDigitos, maxDigitos, country.dial])

  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return COUNTRIES
    return COUNTRIES.filter(
      (c) => normalize(c.name).includes(q) || c.dial.includes(q.replace(/^\+?/, '+')) || c.dial.slice(1).startsWith(q),
    )
  }, [query])

  function choose(c: Country) {
    escolhaFirmada.current = true // …e o gatilho não reabre no mesmo tique
    setIso(c.iso)
    setOpen(false)
    setQuery('')
    setAtivo(-1)
    // O gesto seguinte é digitar o número: o foco vai para lá, não volta para o
    // gatilho (um gatilho que alterna é o pior lugar para pousar depois de
    // escolher).
    numeroRef.current?.focus()
    window.setTimeout(() => {
      escolhaFirmada.current = false
    }, 0)
  }

  function onKeyDown(e: TeclaDoReact<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setAtivo(-1)
      return
    }
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAtivo((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      // Com a lista aberta, Enter ESCOLHE (a destacada, ou a primeira) e não
      // envia o formulário.
      e.preventDefault()
      choose(results[ativo >= 0 ? ativo : 0])
    }
  }

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-stretch gap-2">
      <input type="hidden" name={name} value={e164} />
      <button
        type="button"
        onClick={() => {
          // Escolha firmada cala o gatilho por um tique: é o clique que o
          // `<label>` reencaminha, não um gesto novo da pessoa.
          if (escolhaFirmada.current) {
            escolhaFirmada.current = false
            return
          }
          setOpen((v) => !v)
          setAtivo(-1)
        }}
        className={`${inputCls} flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
        aria-expanded={open}
        aria-label={`País: ${country.name} (${country.dial})`}
      >
        <span>{country.flag}</span>
        <span className="text-ink-600">{country.dial}</span>
        <span className="text-[10px] text-ink-400">▾</span>
      </button>
      <input
        ref={numeroRef}
        id={id}
        type="tel"
        inputMode="tel"
        value={local}
        required={required}
        autoFocus={autoFocus}
        // O `pattern` conta DÍGITOS, não caracteres: o campo aceita espaço,
        // parênteses e hífen (as pessoas escrevem "65 90000-0000"), então um
        // `{8,13}` seco reprovaria o número certo digitado com separadores.
        pattern={`(?:[\\s()-]*\\d){${minDigitos},${maxDigitos}}[\\s()-]*`}
        // Piso pelo comprimento do texto: nunca reprova sozinho um número
        // válido (o texto tem SEMPRE ao menos tantos caracteres quanto
        // dígitos), e derruba na hora o número obviamente curto.
        minLength={minDigitos}
        onChange={(e) => setLocal(e.target.value.replace(/[^\d\s()-]/g, ''))}
        placeholder={country.iso === 'BR' ? 'ex.: (65) 90000-0000' : 'número local'}
        className={`${inputCls} w-44 min-w-0`}
        aria-label={ariaLabel ?? undefined}
        aria-describedby={ariaLabel === null ? dicaId : undefined}
      />
      {/* A dica que o aria-label carregava, no canal certo quando o NOME vem do
          label externo: descrição complementa; label sobreporia. */}
      {ariaLabel === null && (
        <span id={dicaId} className="sr-only">
          Digite sem o código do país — o país vai no seletor ao lado.
        </span>
      )}

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-card border border-line bg-paper-0 p-2 shadow-(--shadow-pop)">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setAtivo(-1)
            }}
            onKeyDown={onKeyDown}
            placeholder="Buscar país ou DDI…"
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls={listaId}
            aria-autocomplete="list"
            aria-activedescendant={ativo >= 0 ? `${listaId}-${ativo}` : undefined}
            className={`${inputCls} w-full`}
          />
          <ul id={listaId} role="listbox" className="mt-1 max-h-52 overflow-y-auto">
            {results.map((c, i) => (
              <li key={c.iso} role="presentation">
                <button
                  type="button"
                  id={`${listaId}-${i}`}
                  role="option"
                  aria-selected={i === ativo}
                  // A lista não é caminho de TAB: quem navega por teclado usa as
                  // setas na busca (aria-activedescendant).
                  tabIndex={-1}
                  // O idioma da corrida blur×click: segurar o foco no
                  // MOUSEDOWN e commitar no CLICK.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                  className={`flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm text-ink-600 hover:bg-paper-100 hover:text-ink-900 ${
                    i === ativo ? 'bg-paper-100 text-ink-900' : ''
                  }`}
                >
                  <span>{c.flag}</span>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-ink-400">{c.dial}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-ink-400">Nenhum país encontrado.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
