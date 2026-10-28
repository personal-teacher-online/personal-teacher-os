'use client'

// QA de UX 14/07/2026 (exceção client aprovada): os popups <details data-popup>
// são CSS-only e ficavam abertos até novo clique no próprio summary. Um ÚNICO
// listener global de mousedown (capture) no document:
//   - fecha todo details[data-popup][open] quando o clique é FORA dele;
//   - clique num summary de um details[data-popup] fechado (vai abrir agora):
//     fecha os OUTROS abertos — um popup por vez.
// Renderiza null; montar uma vez por layout.
import { useEffect } from 'react'

export function PopupManager() {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      // details[data-popup] dono do clique: aberto = clique interno (mantém);
      // fechado = clique no summary que o abrirá em seguida (fecha os outros).
      // Ancestrais do dono ficam abertos (ConfirmAction aninhado no Actions).
      const current = target?.closest('details[data-popup]') ?? null
      for (const d of document.querySelectorAll('details[data-popup][open]')) {
        if (d !== current && !(current && d.contains(current))) d.removeAttribute('open')
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [])
  return null
}
