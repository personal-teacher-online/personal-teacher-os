// Estado de carregamento global. A barra #nav-progress cobre navegações por
// link; este boundary cobre o primeiro render de cada rota. Papel claro (as
// áreas internas dominam o uso diário) com anel na cor da marca.
export default function Loading() {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-paper-50">
      <span
        aria-label="Carregando"
        role="status"
        className="inline-block h-8 w-8 animate-[click-spin_0.8s_linear_infinite] rounded-pill border-2 border-brand-600 border-t-transparent"
      />
    </main>
  )
}
