// Fundo de névoa da marca (Design.md §Movimento). CSS-only — os estilos e
// keyframes vivem em globals.css (.fog*); este componente só monta as camadas.
// Server Component: zero JS no cliente, funciona em SSR sem hidratação.
//
// intensity:
//   'full'   → telas públicas (login, senha…): opacity 0.45, vitrine da marca.
//   'subtle' → portal logado: opacity 0.20 + overlay escuro (contraste AA).
// overlay: força/remove o overlay escuro (default: só no 'subtle').
// vignette: escurece o perímetro — APROVADA em 13/07/2026 como padrão das
//   telas públicas (default: só no 'full').
// scoped: contém o fog no elemento pai (position: absolute) — para caixas de
//   demonstração/preview; o uso real em tela é fixed (default).

type FogBackgroundProps = {
  intensity?: 'full' | 'subtle'
  overlay?: boolean
  vignette?: boolean
  scoped?: boolean
  /** Variante RICA (login): 6 campos de gradiente assíncronos calibrados no
   *  gabarito do Termius (docs/design-video-kit.md §gabarito). Durações
   *  co-primas → o padrão nunca se repete. */
  rich?: boolean
}

export function FogBackground({
  intensity = 'full',
  overlay = intensity === 'subtle',
  vignette = intensity === 'full',
  scoped = false,
  rich = false,
}: FogBackgroundProps) {
  const classes = ['fog', scoped && 'fog--scoped', rich && 'fog--rich']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} data-intensity={intensity} aria-hidden="true">
      <div className="fog__blob fog__blob--1" />
      <div className="fog__blob fog__blob--2" />
      <div className="fog__blob fog__blob--3" />
      {rich && (
        <>
          <div className="fog__field fog__field--r1" />
          <div className="fog__field fog__field--r2" />
          <div className="fog__field fog__field--r3" />
          <div className="fog__field fog__field--r4" />
          <div className="fog__field fog__field--r5" />
          <div className="fog__field fog__field--r6" />
        </>
      )}
      {overlay && <div className="fog__overlay" />}
      {vignette && <div className="fog__vignette" />}
    </div>
  )
}
