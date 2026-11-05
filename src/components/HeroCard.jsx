import { getBorderColor, RARITY_LABEL, FALLBACK_IMG } from '../lib/rarity'
import { cardRating } from '../lib/collectif'
import { useHoloTilt } from '../lib/useHoloTilt'
import './herocard.css'

// Carte "objet physique" : cadre métallisé aux couleurs de la rareté, tranche visible,
// foil + reflet spéculaire qui suivent la souris, ombre portée qui bouge avec l'inclinaison.
// props :
//   card     : carte de la table `cards` (ou null + back pour une carte retournée)
//   back     : affiche le dos (carte adverse inconnue)
//   tilt     : active l'inclinaison au survol (par défaut true)
//   children : badges posés sur la carte (capitaine, multiplicateur…)
export default function HeroCard({ card, back = false, tilt = true, className = '', style, children }) {
  const holo = useHoloTilt({ maxTilt: 14 })
  const r = String(card?.rarity || 'commune').toLowerCase()
  const cc = back ? '#ff4d5e' : getBorderColor(r)
  const gk = /^(gb|g|gk)$/i.test(card?.position || '')
  return (
    <div
      ref={tilt ? holo.ref : undefined}
      {...(tilt ? holo.handlers : {})}
      className={`hc hc-${r}${back ? ' hc-back' : ''} ${className}`}
      style={{ '--cc': cc, ...style }}
    >
      <div className="hc-body">
        <div className="hc-edge" aria-hidden="true" />
        {back ? (
          <div className="hc-face hc-face-back">
            <span className="hc-back-mark">Foot<b>X</b></span>
            <span className="hc-back-q">?</span>
          </div>
        ) : (
          <div className="hc-face">
            <div className="hc-art">
              {card?.image_url
                ? <img src={card.image_url} alt="" draggable="false" onError={(e) => { e.currentTarget.src = FALLBACK_IMG }} />
                : <span className="hc-art-ic">{gk ? '🧤' : '⚽'}</span>}
            </div>
            <div className="hc-top">
              <b>{cardRating(card)}</b>
              <span>{card?.position || '—'}</span>
            </div>
            <div className="hc-meta">
              <em>{RARITY_LABEL[r] || r}</em>
              <strong>{card?.name || 'Joueur'}</strong>
              <small>{[card?.club, card?.country].filter(Boolean).join(' · ')}</small>
            </div>
          </div>
        )}
        <div className="hc-foil" aria-hidden="true" />
        <div className="hc-glare" aria-hidden="true" />
        {children}
      </div>
    </div>
  )
}
