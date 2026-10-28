// Vocabulário de UI das áreas internas ("Papel & Tinta" — Design.md).
// Fonte ÚNICA das classes/peças repetidas: admin, teacher e portal importam
// daqui para o conjunto inteiro envelhecer junto. Server-safe (zero client JS).
import type { ReactNode } from 'react'
import Link from 'next/link'

/* ---------- controles de formulário ---------- */

export const input =
  'min-h-11 rounded-input border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600'
export const inputSm =
  'rounded-input border border-line bg-paper-0 px-2.5 py-1.5 text-xs text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600'
export const btnInk = 'btn-ink'
export const btnPaper = 'btn-paper'
export const btnInkSm = 'btn-ink !min-h-9 !px-3.5 !py-1.5 !text-xs'
export const btnBrand = 'btn-brand'
export const btnBrandSm = 'btn-brand !min-h-9 !px-3.5 !py-1.5 !text-xs'
export const btnPaperSm = 'btn-paper !min-h-9 !px-3 !py-1.5 !text-xs'
export const linkAction = 'text-sm font-semibold text-brand-700 hover:underline'
export const linkActionXs = 'text-xs font-semibold text-brand-700 hover:underline'
export const linkDanger = 'text-xs font-semibold text-danger-700 hover:underline'

/* ---------- chips / segmentos / navegação de período ---------- */

export const chip =
  'inline-flex min-h-11 items-center rounded-pill border px-3 py-1 text-xs whitespace-nowrap transition-colors sm:min-h-9'
export const chipOn = `${chip} border-ink-900 bg-ink-900 font-semibold text-paper-0`
// Leva 3 (item 18/variante B): navegação PRINCIPAL ativa veste a marca; filtros/segmentos utilitários continuam em tinta (chipOn).
export const chipBrandOn = `${chip} border-brand-700 bg-brand-700 font-semibold text-paper-0`
export const chipOff = `${chip} border-line bg-paper-0 text-ink-600 hover:border-ink-600 hover:text-ink-900`

// Setas de período (‹ Hoje ›): toque 44px no celular, 32px no desktop.
export const navArrow =
  'flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper-0 text-ink-600 transition-colors hover:border-ink-600 hover:text-ink-900 sm:h-8 sm:w-8'
export const touchTarget = 'inline-flex min-h-11 items-center justify-center sm:min-h-0'

/* ---------- cor por professora (índice = ordem alfabética por nome) ----------
   Matiz BEM separado (roxo · verde-água · âmbar · rosa · azul); tokens em
   globals.css. Classes literais para o scanner do Tailwind. */

export const TEACHER_FILL = [
  'bg-(--t0-fill)',
  'bg-(--t1-fill)',
  'bg-(--t2-fill)',
  'bg-(--t3-fill)',
  'bg-(--t4-fill)',
]
export const TEACHER_TINT = [
  'bg-(--t0-tint)',
  'bg-(--t1-tint)',
  'bg-(--t2-tint)',
  'bg-(--t3-tint)',
  'bg-(--t4-tint)',
]
export const TEACHER_TEXT = [
  'text-(--t0-fill)',
  'text-(--t1-fill)',
  'text-(--t2-fill)',
  'text-(--t3-fill)',
  'text-(--t4-fill)',
]
export const TEACHER_BORDER = [
  'border-(--t0-fill)',
  'border-(--t1-fill)',
  'border-(--t2-fill)',
  'border-(--t3-fill)',
  'border-(--t4-fill)',
]
export const TEACHER_EDGE = [
  'border-l-(--t0-fill)',
  'border-l-(--t1-fill)',
  'border-l-(--t2-fill)',
  'border-l-(--t3-fill)',
  'border-l-(--t4-fill)',
]

/* ---------- rótulos humanos ---------- */

export const STATE_LABEL: Record<string, string> = {
  scheduled: 'agendada',
  completed: 'realizada',
  cancelled: 'cancelada',
  rescheduled: 'remarcada',
  no_show_student: 'aluno faltou',
  no_show_teacher: 'professora faltou',
}

// Fusos frequentes da escola (o banco valida QUALQUER IANA; isto é atalho de
// digitação, não restrição — "outro…" cai no input livre).

/* ---------- peças ---------- */

type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'neutral' | 'muted'
const TONE_CLS: Record<Tone, string> = {
  ok: 'bg-ok-wash font-semibold text-ok-700',
  // Q1 do c7b: lavagem de estado é HEX SÓLIDO nos dois kits — com alpha o
  // contraste do par dependia do papel de baixo (warn reprovava AA: 3,98:1
  // sobre --paper-100). Ver a nota longa em components/kit/pill.tsx.
  warn: 'bg-warn-wash font-semibold text-warn-700',
  danger: 'bg-danger-wash font-semibold text-danger-700',
  brand: 'bg-brand-700/10 font-semibold text-brand-700',
  neutral: 'bg-paper-100 font-medium text-ink-600',
  muted: 'border border-line font-medium text-ink-600',
}

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs whitespace-nowrap ${TONE_CLS[tone]}`}>
      {children}
    </span>
  )
}

/** Cartão padrão de superfície de leitura. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card) ${className}`}>
      {children}
    </div>
  )
}

/** Cabeçalho de seção: título display + ação à direita. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-display text-base font-bold text-ink-900">{children}</h3>
      {action}
    </div>
  )
}

/** Estado vazio acolhedor: o que significa + próximo passo. */
export function EmptyState({ title, hint, cta, href }: { title: string; hint?: string; cta?: string; href?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-paper-0/60 p-8 text-center">
      <p className="text-sm font-semibold text-ink-600">{title}</p>
      {hint && <p className="max-w-md text-xs leading-relaxed text-ink-400">{hint}</p>}
      {cta && href && (
        <Link href={href} className={`${btnPaperSm} mt-2`}>
          {cta}
        </Link>
      )}
    </div>
  )
}

/** Faixa de mensagem pós-ação (?msg=). Tom decidido pelo prefixo "Falha".
 *  Escala de empilhamento (hallmark audit 19/07): 10 conteúdo sobre fog ·
 *  20 células/grade · 30 popup · 40 confirm/nav flutuante · 50 painel
 *  lateral/trilho/fio · 60 toast (por cima de tudo). Sem números fora da fila. */
export function FlashMsg({ msg }: { msg?: string }) {
  if (!msg) return null
  const isError = /^falha|^não deu/i.test(msg)
  // S2-8/S2-12 (e2e): TOAST fixo no topo do viewport — a resposta da ação
  // aparece ONDE O OLHO ESTÁ, independentemente do scroll (antes nascia no
  // topo do documento e ficava invisível para quem clicou no meio da página).
  return (
    <p
      role="status"
      className={`flash-toast fixed top-3 left-1/2 z-60 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-card border p-3 text-sm font-medium shadow-(--shadow-pop) ${
        isError
          ? 'flash-toast--error border-danger-700/40 bg-paper-0 text-danger-700'
          : 'border-teal-700/40 bg-paper-0 text-teal-700'
      }`}
    >
      {msg}
    </p>
  )
}

/** S2-10 (e2e/TutorBird) — DRAWER lateral direito para ações com FORMULÁRIO
 *  (regra: form ou 3+ campos → drawer; ação de 1 clique → popup pequeno).
 *  CSS-only no padrão da casa: <details data-popup> — o PopupManager fecha no
 *  clique fora; o painel fixo à direita aproveita a altura toda da tela. */
export function Drawer({ label, title, children }: { label?: string; title: string; children: ReactNode }) {
  return (
    <details className="relative" data-popup>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-pill border border-line bg-paper-0 px-3 py-1 text-xs font-medium whitespace-nowrap text-ink-600 transition-colors hover:border-ink-600 hover:text-ink-900 sm:min-h-9">
        {label ?? 'ações'}
      </summary>
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-line bg-paper-0 shadow-(--shadow-pop)">
        <div className="brand-thread shrink-0" aria-hidden />
        <div className="flex items-baseline justify-between gap-3 px-6 pt-5 pb-3">
          <h3 className="font-display text-lg font-bold text-ink-900">{title}</h3>
          <span className="text-[11px] text-ink-400">clique fora para fechar</span>
        </div>
        <div className="flex-1 px-6 pb-8">{children}</div>
      </div>
    </details>
  )
}

/** Link com a MESMA cara do gatilho do ToolbarForm — abre fluxos que viraram
 * SidePanel (padrão TutorBird): o botão fica na toolbar, o form na lateral. */
export const toolbarLink =
  'inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-line bg-paper-0 px-4 py-1.5 text-sm font-medium whitespace-nowrap text-ink-600 transition-colors hover:border-ink-600 hover:text-ink-900 sm:min-h-9'

/** Painel lateral ABERTO por estado de URL (?novo=…): a lista fica por baixo,
 * o form desliza pela direita — padrão TutorBird pedido no e2e (S2-14 e
 * objeções da sessão 2). Server-safe: overlay e ✕ são Links para closeHref. */
export function SidePanel({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50">
      <Link href={closeHref} aria-label="Fechar painel" className="absolute inset-0 bg-ink-900/25" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-line bg-paper-0 shadow-(--shadow-pop)">
        <div className="brand-thread shrink-0" aria-hidden />
        <div className="flex items-baseline justify-between gap-3 px-6 pt-5 pb-4">
          <h2 className="font-display text-xl font-bold text-ink-900">{title}</h2>
          <Link href={closeHref} className="text-xs font-semibold text-ink-400 transition-colors hover:text-ink-900">
            ✕ fechar
          </Link>
        </div>
        <div className="flex-1 px-6 pb-10">{children}</div>
      </aside>
    </div>
  )
}

/** Popup de ações CSS-only (details/summary) — fechado pelo PopupManager. */
export function Actions({ label = 'ações', children, align = 'right' }: { label?: string; children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <details className="relative" data-popup>
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-pill border border-line bg-paper-0 px-3 py-1 text-sm font-medium whitespace-nowrap text-ink-600 transition-colors hover:border-ink-600 hover:text-ink-900">
        {label}
      </summary>
      <div
        className={`absolute z-30 mt-1.5 flex w-max max-w-[88vw] flex-col gap-3 rounded-card border border-line bg-paper-0 p-4 shadow-(--shadow-pop) ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {children}
      </div>
    </details>
  )
}

/** Confirmação em dois passos para ações de dinheiro/registro: o 1º clique
 * mostra o EFEITO; a mutação só dispara no botão de dentro. */
export function ConfirmAction({
  label,
  warning,
  confirmLabel,
  action,
  values,
  align = 'right',
}: {
  label: string
  warning: string
  confirmLabel: string
  action: (formData: FormData) => Promise<void> | void
  values: Record<string, string>
  align?: 'left' | 'right'
}) {
  return (
    <details className="relative" data-popup>
      <summary className={`cursor-pointer list-none ${linkDanger}`}>{label}</summary>
      <div
        className={`absolute z-40 mt-1.5 flex w-64 flex-col gap-3 rounded-card border border-line bg-paper-0 p-4 shadow-(--shadow-pop) ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        <p className="text-xs leading-relaxed text-ink-600">{warning}</p>
        <form action={action}>
          {Object.entries(values).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <button type="submit" className={linkDanger}>
            {confirmLabel}
          </button>
        </form>
      </div>
    </details>
  )
}


/** Campo com rótulo explícito; hint ACIMA do input para alinhar linhas de base
 * em grids com items-end.
 *
 * `para` (28/07, mesma lição do M3-c4 · B1): um `<label>` que embrulha o campo
 * rotula o PRIMEIRO controle rotulável da árvore — num campo composto como o
 * CountryPhoneField, isso é o BOTÃO do país, e o clique no rótulo abria a
 * lista em vez de focar o telefone.
 *
 * Rodada 2 do Sol (achado 5): com `para`, o rótulo vira IRMÃO dos filhos, não
 * ancestral. Um `<label htmlFor>` que ainda CONTÉM outro controle rotulável (o
 * botão de país) é HTML inválido/ambíguo para tecnologia assistiva — o `for`
 * aponta um controle e o embrulho captura outro. O wrapper `<div>` herda o
 * layout que o label tinha; sem `para`, o comportamento antigo fica intacto. */
export function Field({
  label,
  children,
  hint,
  para,
}: {
  label: string
  children: ReactNode
  hint?: string
  /** `id` do controle que o rótulo deve apontar, quando ele não é o primeiro rotulável */
  para?: string
}) {
  const rotulo = (
    <>
      <span className="text-xs font-semibold text-ink-600">{label}</span>
      {hint && <span className="text-[11px] leading-snug text-ink-400">{hint}</span>}
    </>
  )
  if (para) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={para} className="flex flex-col gap-1">
          {rotulo}
        </label>
        {children}
      </div>
    )
  }
  return (
    <label className="flex min-w-0 flex-col gap-1">
      {rotulo}
      {children}
    </label>
  )
}
