import { useRef } from 'react'
import './pack.css'

// Visuel du booster FootX (design original) : sachet foil, sertissages crantés,
// holographie + inclinaison qui suivent la souris.
// Utilisé sur la page Boosters (vitrine) ET dans l'ouverture (où on le déchire).
//
// props :
//   packs     : nombre de boosters (affiché sur le badge)
//   torn      : bande du haut arrachée
//   prog      : 0..1 progression de la déchirure (traînée lumineuse)
//   idle      : vitrine (pas d'indice de déchirure animé)
//   packRef   : ref optionnelle vers l'élément .pk
//   onPointer*: gestes (la déchirure est gérée par le parent)
const zigTop = (n, d) => `polygon(${Array.from({ length: n + 1 }, (_, i) => `${(i / n) * 100}% ${i % 2 ? 0 : d}%`).join(',')},100% 100%,0% 100%)`
const zigBottomPts = (n, d) => Array.from({ length: n + 1 }, (_, i) => n - i).map((i) => `${(i / n) * 100}% ${i % 2 ? 100 : 100 - d}%`)
const TORN_Y = [34, 0, 58, 12, 72, 4, 44, 0, 62, 16, 38, 0, 68, 9, 48, 0, 60, 14, 36, 3, 64, 22, 30]
const tornPts = TORN_Y.map((y, i) => `${(i / (TORN_Y.length - 1)) * 100}% ${y * 0.035}%`)
const CLIP_TOP = zigTop(30, 30)
const CLIP_MAIN = `polygon(0% 0%,100% 0%,${zigBottomPts(30, 2.4).join(',')})`
const CLIP_MAIN_TORN = `polygon(${tornPts.join(',')},${zigBottomPts(30, 2.4).join(',')})`

export default function BoosterPack({
  packs = 1, torn = false, prog = 0, idle = false, className = '', packRef,
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave,
}) {
  const own = useRef(null)
  const ref = packRef || own

  const tilt = (e) => {
    const el = ref.current
    if (!el || torn) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--mx', `${px * 100}%`)
    el.style.setProperty('--my', `${py * 100}%`)
    el.style.setProperty('--rx', `${(py - 0.5) * -14}deg`)
    el.style.setProperty('--ry', `${(px - 0.5) * 16}deg`)
  }
  const untilt = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  return (
    <div
      ref={ref}
      className={'pk' + (torn ? ' torn' : '') + (prog > 0 && !torn ? ' pulling' : '') + (idle ? ' idle' : '') + (className ? ' ' + className : '')}
      style={{ '--tp': prog }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { tilt(e); onPointerMove?.(e) }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={(e) => { if (onPointerLeave) onPointerLeave(e, untilt); else untilt() }}
    >
      <div className="pk-main" style={{ clipPath: torn ? CLIP_MAIN_TORN : CLIP_MAIN }}>
        <div className="pk-art">
          <div className="pk-pitch" />
          <div className="pk-badge"><span className="pk-ring" /><span className="pk-mono">FX</span></div>
          <div className="pk-word">FOOTX</div>
          <div className="pk-ed"><i />Édition Top 5 Ligues<i /></div>
        </div>
        <div className="pk-count">{packs > 1 ? `${packs} boosters` : '10 cartes'}</div>
        <div className="pk-holo" />
        <div className="pk-shine" />
        <div className="pk-spill" />
        <div className="pk-crimp bottom" />
      </div>
      <div className="pk-top">
        <div className="pk-crimp" style={{ clipPath: CLIP_TOP }} />
        <div className="pk-band" />
        <div className="pk-tear"><i /><b /></div>
      </div>
    </div>
  )
}
