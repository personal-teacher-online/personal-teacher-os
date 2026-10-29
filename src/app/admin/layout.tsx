// Shell do admin — "Papel & Tinta": moldura de navegação em tinta escura (eco
// da capa noturna das públicas) e superfície de trabalho em papel claro.
//
// Onda 1 · M1 (item 8): o trilho passa a ser o da IA de 26/07 (`AdminShell`).
// O `PopupManager` continua aqui porque as telas VELHAS ainda usam
// `<details data-popup>` — remover é escopo de outra onda; nenhuma tela nova o
// usa. O `<Toaster>` do kit entra agora: é por ele que a ação da tela nova
// devolve feedback, no lugar do `?msg=` na URL.
//
// ⚠️ NÃO envolver o `AdminShell` num `<Suspense>` (revisão adversarial nº 1,
// C4). Havia um aqui, com `fallback={null}`, e ele fazia o contrário do que
// prometia: qualquer página legada (todas são `async`) que suspendesse sem
// boundary própria subia até ele e APAGAVA o admin inteiro — trilho, barra de
// polegar e conteúdo — em vez de piscar só o miolo. As peças que leem a URL
// (AdminRail, AdminThumbBar) têm as fronteiras delas DENTRO do shell, que é
// onde elas têm de estar; a espera da página é coberta por `loading.tsx`.
//
// A bancada de decisão visual (alternador de paletas) morava aqui e MORREU com
// o martelo de D10/D7 em 26/07: o tema é o `:root` do globals.css.
import { AdminShell } from '@/components/admin/AdminShell'
import { Toaster } from '@/components/kit/toaster'
import { PopupManager } from '@/components/PopupManager'
import { UiBeacon } from '@/components/UiBeacon'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-surface="paper"
      className="flex min-h-dvh w-full flex-col bg-paper-50 text-ink-900 [color-scheme:light] md:flex-row"
    >
      <PopupManager />
      <UiBeacon />
      <Toaster />
      {/* O fio-assinatura de gradiente MORREU no admin (clonagem TutorBird,
          26/07): a barra superior branca não convive com um degrau de degradê
          por cima — e a marca já assina o trilho inteiro, em cor sólida. Ele
          continua vivo nos e-mails e nas telas do portal, que não mudaram. */}
      <h1 className="sr-only">Personal Teacher Academy — Administração</h1>
      <AdminShell>{children}</AdminShell>
    </div>
  )
}
