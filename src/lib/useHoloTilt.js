import { useRef, useCallback } from 'react'

// Reflet holographique + inclinaison 3D qui suivent la souris (Mission 1 "juiciness").
// Réutilisable sur n'importe quelle carte — y compris le booster de la page Boosters.
//
// usage :
//   const holo = useHoloTilt()
//   <div ref={holo.ref} {...holo.handlers} className="pcard">
//     ... <div className="holo-sheen" /> ...
//   </div>
// Le composant doit exposer un enfant qui lit --mx / --my (voir .holo-sheen dans match.css).
export function useHoloTilt({ maxTilt = 12 } = {}) {
  const ref = useRef(null)

  const onMove = useCallback((e) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--mx', (px * 100) + '%')
    el.style.setProperty('--my', (py * 100) + '%')
    const rx = (py - 0.5) * -2 * maxTilt
    const ry = (px - 0.5) * 2 * maxTilt
    el.style.setProperty('--rx', rx + 'deg')
    el.style.setProperty('--ry', ry + 'deg')
    el.classList.add('is-tilting')
  }, [maxTilt])

  const onLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove('is-tilting')
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }, [])

  return { ref, handlers: { onMouseMove: onMove, onMouseLeave: onLeave } }
}
