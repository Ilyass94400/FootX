import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { avatarSvg } from '../../lib/legend/avatar'
import { ultimateCharge, ultimateImpact } from '../../lib/legend/sfx'
import './ultimate.css'

// ============================================================================
// Cinématique de Capacité Ultime (composant isolé, CSS keyframes uniquement).
//   <UltimateCutscene ult={ULTIMATES.meteore} look={…} number={9} name="Ilyass" onDone={…} />
// Chronologie (≈ 2,6 s) :
//   0.00 s  l'écran s'assombrit, lignes de vitesse, bandes noires en biais
//   0.20 s  le portrait jaillit avec son aura de flammes
//   0.70 s  éclat dans le regard
//   0.80 s  le nom de la technique s'écrase à l'écran (aberration chromatique)
//   1.35 s  le ballon traverse l'écran avec une traînée de feu
//   1.50 s  IMPACT : flash blanc + secousse violente + onde de choc
//   2.20 s  fondu de sortie → onDone()
// ============================================================================
export const ULTIMATE_MS = 2600

export default function UltimateCutscene({ ult, look, number = 10, name, onDone, caption }) {
  useEffect(() => {
    ultimateCharge()
    const t1 = setTimeout(ultimateImpact, 1480)
    const t2 = setTimeout(() => onDone?.(), ULTIMATE_MS)
    try { navigator.vibrate?.([0, 1480, 120, 60, 80]) } catch { /* pas de vibreur */ }
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const portrait = 'data:image/svg+xml;utf8,' + encodeURIComponent(avatarSvg(look, { number, background: false }))
  // lettres groupées par mot : le titre ne se coupe jamais au milieu d'un mot
  let n = 0
  const words = (ult?.name || '').split(' ').map((w) => w.split('').map((ch) => ({ ch, i: n++ })))
  return createPortal(
    <div className={'uc ' + (ult?.side || 'atk')} style={{ '--u1': ult?.color || '#ff6a2b', '--u2': ult?.color2 || '#ffd25c' }} role="presentation" aria-label={ult?.name}>
      <div className="uc-shake">
        <div className="uc-dim" />
        <div className="uc-lines" />
        <div className="uc-slash top" />
        <div className="uc-slash bottom" />

        <div className="uc-hero">
          <div className="uc-aura"><i /><i /><i /><i /><i /><i /></div>
          <img className="uc-portrait" src={portrait} alt="" draggable="false" />
          <i className="uc-glint" />
        </div>

        <div className="uc-title">
          {caption && <span className="uc-cap">{caption}</span>}
          <span className="uc-who">{name}</span>
          <h2 className="uc-name" data-text={ult?.name}>
            {words.map((w, k) => (
              <span key={k} className="w">{w.map(({ ch, i }) => <span key={i} style={{ '--i': i }}>{ch}</span>)}{k < words.length - 1 ? ' ' : ''}</span>
            ))}
          </h2>
          <span className="uc-line">{ult?.line}</span>
        </div>

        <div className="uc-ball"><i className="uc-trail" /><i className="uc-orb" /></div>
        <div className="uc-ring" />
        <div className="uc-flash" />
      </div>
    </div>,
    document.body,
  )
}
