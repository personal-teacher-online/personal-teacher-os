// Shell do painel da professora — "Papel & Tinta": faixa de tinta no topo
// (eco da capa noturna) e superfície de papel para a leitura densa da agenda.
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PopupManager } from '@/components/PopupManager'
import { UiBeacon } from '@/components/UiBeacon'
import { Toaster } from '@/components/kit/toaster'
import { RecadoDoPortal } from '@/components/portal/RecadoDoPortal'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  // S2-3 (e2e): a dona vive nos DOIS papéis — quem é admin ganha a volta;
  // a professora (só teacher) nunca vê o link.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isAdmin = (user?.app_metadata as Record<string, unknown> | undefined)?.role === 'admin'
  return (
    <div data-surface="paper" className="flex min-h-dvh w-full flex-col bg-paper-50 text-ink-900 [color-scheme:light]">
      <PopupManager />
      <UiBeacon />
      {/* O desfecho de cancelar/remarcar chega por cookie de flash (nunca pela URL):
          o mesmo toast do portal, lido aqui na moldura. */}
      <Toaster />
      <RecadoDoPortal />
      <header className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-3 md:px-8">
        <span className="flex items-center gap-2.5">
          <Image src="/brand/simbolo-branco.png" alt="" width={22} height={22} className="h-[22px] w-[22px] opacity-90" />
          <span className="font-display text-[15px] font-bold text-white">
            Personal Teacher <span className="ml-1 text-[11px] font-medium tracking-wide text-white/45">Painel da professora</span>
          </span>
        </span>
        <span className="flex items-center gap-1">
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-input px-3 py-1.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              ← Administração
            </Link>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-input px-3 py-1.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              Sair
            </button>
          </form>
        </span>
      </header>
      <div className="brand-thread" aria-hidden />
      <div className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 md:px-6">{children}</div>
    </div>
  )
}
