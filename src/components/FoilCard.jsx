import { useRef } from 'react'
import { getBorderColor, RARITY_LABEL, FALLBACK_IMG } from '../lib/rarity'

// Carte de révélation : foil holographique qui suit la souris.
// L'animation d'entrée est portée par .fcard-anim (wrapper) pour ne PAS entrer en conflit
// avec le transform de survol de .fcard (sinon la carte "rejoue" / disparaît au survol).
// props : card, best, delay (s), onClick, plain (sans anim d'entrée ni tilt — pour le flip du pack)
export default function FoilCard({ card, best = false, delay = 0, onClick, plain = false }) {
  const ref = useRef(null)
  const cc = getBorderColor(card.rarity)
  const iconic = card.rarity?.toLowerCase() === 'iconique'

  const move = (e) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--mx', px * 100 + '%')
    el.style.setProperty('--my', py * 100 + '%')
    const face = el.querySelector('.fcard-face')
    face.style.setProperty('--rx', (py - 0.5) * -14 + 'deg')
    face.style.setProperty('--ry', (px - 0.5) * 14 + 'deg')
    el.classList.add('tilt')
  }
  const leave = () => {
    const el = ref.current
    if (!el) return
    el.classList.remove('tilt')
    const face = el.querySelector('.fcard-face')
    face.style.setProperty('--rx', '0deg')
    face.style.setProperty('--ry', '0deg')
  }

  return (
    <div className="slot">
      <div className={'fcard-anim' + (plain ? ' plain' : '')} style={{ animationDelay: delay + 's' }}>
        <div
          ref={ref}
          onMouseMove={plain ? undefined : move}
          onMouseLeave={plain ? undefined : leave}
          onClick={onClick}
          className={'fcard ' + (card.rarity?.toLowerCase() || '') + (best ? ' best' : '') + (iconic ? ' iconique' : '')}
          style={{ '--cc': cc }}
        >
          <div className="fcard-face">
            <div className="top">
              <div className="rating">
                {typeof card.rating === 'number' && <b>{card.rating}</b>}
                <span>{card.position}</span>
              </div>
            </div>
            <div className="crest">
              {card.image_url
                ? <img src={card.image_url} alt={card.name} onError={(e) => { e.target.src = FALLBACK_IMG }} />
                : <div className="ic">{/^(gb|g|gk)$/i.test(card.position || '') ? '🧤' : '⚽'}</div>}
            </div>
            <div className="rar">{RARITY_LABEL[card.rarity?.toLowerCase()] || card.rarity}</div>
            <div className="meta"><div className="nm">{card.name}</div><div className="cl">{card.club} · {card.country}</div></div>
            <div className="foil" />
          </div>
        </div>
      </div>
    </div>
  )
}
