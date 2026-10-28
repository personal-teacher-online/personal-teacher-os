import Image from 'next/image'

export const metadata = { title: 'Vendas — Personal Teacher' }

// Placeholder com guard (o proxy segmenta por papel) — visão de leads em fase
// futura. hallmark audit 19/07: mesmo provisória, a tela veste a moldura da
// marca (faixa de tinta + fio-assinatura + logo), como toda superfície interna.
export default function SalesPage() {
  return (
    <div
      data-surface="paper"
      className="flex min-h-dvh w-full flex-col bg-paper-50 text-ink-900 [color-scheme:light]"
    >
      <header className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-3 md:px-8">
        <span className="flex items-center gap-2.5">
          <Image
            src="/brand/simbolo-branco.png"
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] opacity-90"
          />
          <span className="font-display text-[15px] font-bold text-white">Personal Teacher</span>
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-input px-3 py-1.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            Sair
          </button>
        </form>
      </header>
      <div className="brand-thread" aria-hidden />
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="rounded-card border border-line-soft bg-paper-0 p-6 text-sm text-ink-600 shadow-(--shadow-card)">
          A visão de vendas chega em uma fase futura. Você está logada e no lugar certo.
        </p>
      </main>
    </div>
  )
}
